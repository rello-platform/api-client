import type { Transport } from "../transport.js";
import type { AppInfo } from "../types/platform.js";
import { ServiceClient } from "../service-client.js";

/** Cache entry: app info + expiry timestamp. */
interface CacheEntry {
  app: AppInfo;
  expiresAt: number;
}

/** Cache TTL: 5 minutes. Platform has ~15 registered apps — cache is tiny. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Platform resource — app registry lookups and service resolution.
 *
 * Enables spoke apps to discover service URLs from Rello instead of
 * hardcoded env vars. Results are cached for 5 minutes.
 */
export class PlatformResource {
  /** In-memory cache: slug → { app, expiresAt }. */
  private readonly appCache = new Map<string, CacheEntry>();

  constructor(private readonly transport: Transport) {}

  /**
   * Look up a registered platform app by slug.
   *
   * Calls `GET /api/v1/platform/apps/{slug}` on cache miss or stale.
   * Only returns STABLE and BETA apps — DEVELOPMENT/DEPRECATED/RETIRED
   * return RelloNotFoundError (404).
   *
   * @throws {RelloNotFoundError} If the app doesn't exist or isn't production-ready.
   *
   * @example
   *   const pe = await rello.platform.getApp("property-engine");
   *   console.log(pe.baseUrl); // "https://property-engine-production.up.railway.app"
   */
  async getApp(slug: string): Promise<AppInfo> {
    // Check cache first
    const cached = this.appCache.get(slug);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.app;
    }

    // The platform endpoint doesn't require a tenant — pass empty string.
    // requireV1PlatformAuth on the server side skips tenant validation.
    const res = await this.transport.get<{ app: AppInfo }>(
      `/platform/apps/${slug}`,
      "",
    );

    const app = res.app;

    // Cache the result
    this.appCache.set(slug, {
      app,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return app;
  }

  /**
   * Resolve a ServiceClient for a registered platform app.
   *
   * Looks up the app's baseUrl from the registry and creates a ServiceClient
   * with retry + circuit breaker. The ServiceClient uses the same API key
   * as the RelloClient — spoke-to-spoke auth is validated by the receiving
   * app (which fetches authorized key hashes from Rello's service-keys endpoint).
   *
   * @throws {Error} If the app has no baseUrl configured.
   * @throws {RelloNotFoundError} If the app doesn't exist or isn't production-ready.
   *
   * @example
   *   const pe = await rello.platform.resolveService("property-engine");
   *   const data = await pe.get("/api/lookups/123");
   */
  async resolveService(slug: string): Promise<ServiceClient> {
    const app = await this.getApp(slug);

    if (!app.baseUrl) {
      throw new Error(
        `@rello-platform/api-client: App '${slug}' has no baseUrl configured in the registry`
      );
    }

    return new ServiceClient({
      baseUrl: app.baseUrl,
      apiKey: this.transport.getApiKey(),
      appSlug: this.transport.getAppSlug(),
    });
  }
}
