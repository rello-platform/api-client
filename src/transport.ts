import { randomUUID } from "crypto";
import {
  RelloError,
  RelloNotFoundError,
  RelloAuthError,
  RelloForbiddenError,
  RelloValidationError,
  RelloRateLimitError,
  RelloUnavailableError,
} from "./errors.js";
import { withRetry } from "./retry.js";
import { CircuitBreaker } from "./circuit-breaker.js";

export interface TransportConfig {
  baseUrl: string;
  apiKey: string;
  appSlug: string;
  timeouts?: Partial<TimeoutConfig>;
  retryAttempts?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerCooldownMs?: number;
}

export interface TimeoutConfig {
  default: number;
  read: number;
  write: number;
  long: number;
}

const DEFAULT_TIMEOUTS: TimeoutConfig = {
  default: 10_000,
  read: 10_000,
  write: 15_000,
  long: 30_000,
};

export type TimeoutPreset = keyof TimeoutConfig;

export class Transport {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly appSlug: string;
  private readonly timeouts: TimeoutConfig;
  private readonly retryAttempts: number;
  private readonly circuitBreaker: CircuitBreaker;

  constructor(config: TransportConfig) {
    // Strip trailing slash from baseUrl
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.appSlug = config.appSlug;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...config.timeouts };
    this.retryAttempts = config.retryAttempts ?? 3;
    this.circuitBreaker = new CircuitBreaker(
      config.circuitBreakerThreshold ?? 5,
      config.circuitBreakerCooldownMs ?? 30_000
    );
  }

  /** Returns the app slug used for X-App-Slug header and signal source attribution. */
  getAppSlug(): string {
    return this.appSlug;
  }

  /** Returns the API key used for Authorization headers. Used by PlatformResource to create ServiceClients. */
  getApiKey(): string {
    return this.apiKey;
  }

  /**
   * Make an authenticated request to Rello.
   */
  async request<T>(
    method: string,
    path: string,
    options: {
      tenantId: string;
      body?: unknown;
      query?: Record<string, string | undefined>;
      timeout?: TimeoutPreset;
      headers?: Record<string, string>;
      /** Override the default `/api/v1` prefix (e.g., `/api` for non-v1 routes). */
      apiPrefix?: string;
    }
  ): Promise<T> {
    const requestId = randomUUID();
    const timeoutMs = this.timeouts[options.timeout ?? "default"];

    // Build URL with query parameters
    let url = `${this.baseUrl}${options.apiPrefix ?? '/api/v1'}${path}`;
    if (options.query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) {
          params.set(key, value);
        }
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "X-App-Slug": this.appSlug,
      "X-Tenant-Id": options.tenantId,
      "X-API-Version": "v1",
      "X-Request-Id": requestId,
      ...options.headers,
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    };

    if (options.body !== undefined) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    return this.circuitBreaker.execute(() =>
      withRetry(
        () => this.doFetch<T>(url, fetchOptions, path, requestId),
        this.retryAttempts
      )
    );
  }

  private async doFetch<T>(
    url: string,
    fetchOptions: RequestInit,
    path: string,
    requestId: string
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, fetchOptions);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new RelloUnavailableError(
          `Request timed out: ${path}`,
          5
        );
      }
      // Network error or other fetch failure
      throw new RelloUnavailableError(
        `Network error: ${error instanceof Error ? error.message : "fetch failed"}`,
        5
      );
    }

    if (res.ok) {
      // Handle 204 No Content
      if (res.status === 204) {
        return undefined as T;
      }
      return res.json() as Promise<T>;
    }

    // Parse error body
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
    }

    const responseRequestId = res.headers.get("X-Request-Id") ?? requestId;

    switch (res.status) {
      case 400:
        throw new RelloValidationError(path, responseRequestId, body);
      case 401:
        throw new RelloAuthError(path, responseRequestId, body);
      case 403:
        throw new RelloForbiddenError(path, responseRequestId, body);
      case 404:
        throw new RelloNotFoundError(path, responseRequestId, body);
      case 429: {
        const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10);
        throw new RelloRateLimitError(path, responseRequestId, body, retryAfter);
      }
      default:
        throw new RelloError(
          `Rello API error ${res.status}: ${path}`,
          res.status,
          path,
          responseRequestId,
          body
        );
    }
  }

  // Convenience methods

  async get<T>(
    path: string,
    tenantId: string,
    query?: Record<string, string | undefined>,
    timeout?: TimeoutPreset
  ): Promise<T> {
    return this.request<T>("GET", path, { tenantId, query, timeout });
  }

  async post<T>(
    path: string,
    tenantId: string,
    body: unknown,
    timeout?: TimeoutPreset
  ): Promise<T> {
    return this.request<T>("POST", path, { tenantId, body, timeout: timeout ?? "write" });
  }

  async patch<T>(
    path: string,
    tenantId: string,
    body: unknown,
    timeout?: TimeoutPreset
  ): Promise<T> {
    return this.request<T>("PATCH", path, { tenantId, body, timeout: timeout ?? "write" });
  }

  async delete<T>(
    path: string,
    tenantId: string,
    timeout?: TimeoutPreset
  ): Promise<T> {
    return this.request<T>("DELETE", path, { tenantId, timeout: timeout ?? "write" });
  }

  /**
   * GET a non-v1 route (uses `/api` prefix instead of `/api/v1`).
   */
  async getRaw<T>(
    path: string,
    tenantId: string,
    query?: Record<string, string | undefined>,
    timeout?: TimeoutPreset
  ): Promise<T> {
    return this.request<T>("GET", path, { tenantId, query, timeout, apiPrefix: "/api" });
  }

  /**
   * POST to a non-v1 route (uses `/api` prefix instead of `/api/v1`).
   */
  async postRaw<T>(
    path: string,
    tenantId: string,
    body?: unknown,
    timeout?: TimeoutPreset
  ): Promise<T> {
    return this.request<T>("POST", path, { tenantId, body, timeout, apiPrefix: "/api" });
  }
}
