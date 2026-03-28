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

export interface ServiceClientConfig {
  /** Base URL of the target service (e.g., process.env.NEWSLETTER_STUDIO_URL). */
  baseUrl: string;
  /** API key for the target service. */
  apiKey: string;
  /** This app's slug, sent as X-App-Slug. */
  appSlug: string;
  /** Request timeout in milliseconds. Default: 10000. */
  timeoutMs?: number;
  /** Number of retry attempts. Default: 3. */
  retryAttempts?: number;
}

/**
 * Generic service-to-service client for spoke-to-spoke calls.
 * Provides the same retry, circuit breaker, and error handling
 * as the Rello client, but targets any platform service.
 */
export class ServiceClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly appSlug: string;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;
  private readonly circuitBreaker: CircuitBreaker;

  constructor(config: ServiceClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.appSlug = config.appSlug;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.retryAttempts = config.retryAttempts ?? 3;
    this.circuitBreaker = new CircuitBreaker();
  }

  async post<T>(
    path: string,
    body: unknown,
    tenantId?: string
  ): Promise<T> {
    return this.request<T>("POST", path, body, tenantId);
  }

  async get<T>(
    path: string,
    tenantId?: string
  ): Promise<T> {
    return this.request<T>("GET", path, undefined, tenantId);
  }

  async patch<T>(
    path: string,
    body: unknown,
    tenantId?: string
  ): Promise<T> {
    return this.request<T>("PATCH", path, body, tenantId);
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    tenantId?: string
  ): Promise<T> {
    const requestId = randomUUID();
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "X-App-Slug": this.appSlug,
      "X-Request-Id": requestId,
    };

    if (tenantId) {
      headers["X-Tenant-Id"] = tenantId;
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    };

    if (body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }

    return this.circuitBreaker.execute(() =>
      withRetry(async () => {
        let res: Response;
        try {
          res = await fetch(url, fetchOptions);
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            throw new RelloUnavailableError(`Request timed out: ${path}`, 5);
          }
          throw new RelloUnavailableError(
            `Network error: ${error instanceof Error ? error.message : "fetch failed"}`,
            5
          );
        }

        if (res.ok) {
          if (res.status === 204) return undefined as T;
          return res.json() as Promise<T>;
        }

        let errorBody: unknown;
        try {
          errorBody = await res.json();
        } catch {
          errorBody = await res.text().catch(() => null);
        }

        switch (res.status) {
          case 400: throw new RelloValidationError(path, requestId, errorBody);
          case 401: throw new RelloAuthError(path, requestId, errorBody);
          case 403: throw new RelloForbiddenError(path, requestId, errorBody);
          case 404: throw new RelloNotFoundError(path, requestId, errorBody);
          case 429: {
            const ra = parseInt(res.headers.get("Retry-After") ?? "60", 10);
            throw new RelloRateLimitError(path, requestId, errorBody, ra);
          }
          default:
            throw new RelloError(
              `Service error ${res.status}: ${path}`,
              res.status, path, requestId, errorBody
            );
        }
      }, this.retryAttempts)
    );
  }
}
