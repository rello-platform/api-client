import { createHash } from "crypto";
import type { PermissionSlug } from "@rello-platform/permissions";

/**
 * Configuration for the platform key validator.
 */
export interface PlatformKeyValidatorConfig {
  /** Rello API base URL (e.g., "https://hellorello.app"). Must NOT include "/api". */
  relloApiUrl: string;
  /** API key to authenticate with Rello's service-keys endpoint. */
  relloApiKey: string;
  /**
   * This app's identifier, passed as the targetApp query parameter.
   * Accepts any format — will be normalized to UPPER_SNAKE_CASE for the API call.
   * Example: "newsletter-studio" or "NEWSLETTER_STUDIO"
   */
  ownAppSlug: string;
  /** Cache TTL in milliseconds. Default: 300000 (5 minutes). */
  cacheTtlMs?: number;
}

/**
 * A cached service key entry fetched from Rello.
 */
interface CachedKey {
  id: string;
  appSource: string;
  keyHash: string;
  permissions: readonly PermissionSlug[];
}

/**
 * Result of a successful caller validation.
 */
export interface PlatformCaller {
  /** The appSource from the ApiKey record (e.g., "THE_DRUMBEAT"). */
  appSource: string;
  /** The ApiKey record ID. */
  keyId: string;
  /** Permissions array from the ApiKey record. Canonical slugs from `@rello-platform/permissions`. */
  permissions: readonly PermissionSlug[];
}

/**
 * Create a validator for inbound platform service-to-service calls.
 *
 * The returned function authenticates incoming requests by:
 *   1. Extracting the Bearer token from the Authorization header
 *   2. SHA-256 hashing the token
 *   3. Comparing the hash against keys fetched from Rello (cached 5 min)
 *
 * Identity comes from the token itself — not from X-App-Slug. The caller
 * is identified by which key they hold, preventing self-reported identity spoofing.
 *
 * Graceful degradation: if Rello is unreachable, the last-known key cache
 * is used. Keys don't rotate often, so stale data is safer than failing auth.
 *
 * @example
 *   import { createPlatformKeyValidator } from "@rello-platform/api-client";
 *
 *   const validateCaller = createPlatformKeyValidator({
 *     relloApiUrl: process.env.RELLO_API_URL!,
 *     relloApiKey: process.env.RELLO_API_KEY!,
 *     ownAppSlug: process.env.APP_SLUG!,
 *   });
 *
 *   // In a route handler or middleware:
 *   const caller = await validateCaller(request);
 *   if (!caller) {
 *     return new Response("Unauthorized", { status: 401 });
 *   }
 *   console.log(`Authenticated caller: ${caller.appSource}`);
 */
export function createPlatformKeyValidator(
  config: PlatformKeyValidatorConfig
): (request: Request) => Promise<PlatformCaller | null> {
  const baseUrl = config.relloApiUrl.replace(/\/+$/, "").replace(/\/api\/?$/, "");
  const targetApp = config.ownAppSlug.toUpperCase().replace(/-/g, "_");
  const cacheTtlMs = config.cacheTtlMs ?? 5 * 60 * 1000;

  let keyCache: CachedKey[] = [];
  let lastFetchTime = 0;
  let fetchInProgress: Promise<void> | null = null;

  /**
   * Fetch expected keys from Rello. Updates the cache on success.
   * On failure, logs a warning and leaves the stale cache in place.
   */
  async function refreshCache(): Promise<void> {
    try {
      const url = `${baseUrl}/api/v1/platform/service-keys?targetApp=${encodeURIComponent(targetApp)}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${config.relloApiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        console.warn(
          `[PlatformKeyValidator] Failed to fetch service keys: ${res.status} ${res.statusText}`
        );
        return;
      }

      const data = await res.json();
      const keys: unknown[] = data.keys;

      if (!Array.isArray(keys)) {
        console.warn("[PlatformKeyValidator] Invalid response: keys is not an array");
        return;
      }

      keyCache = keys.map((k: unknown) => {
        const entry = k as Record<string, unknown>;
        return {
          id: String(entry.id ?? ""),
          appSource: String(entry.appSource ?? ""),
          keyHash: String(entry.keyHash ?? ""),
          permissions: Array.isArray(entry.permissions)
            ? (entry.permissions.map(String) as PermissionSlug[])
            : [],
        };
      });

      lastFetchTime = Date.now();
    } catch (error) {
      // Network error or timeout — keep using stale cache
      if (error instanceof DOMException && error.name === "AbortError") {
        console.warn("[PlatformKeyValidator] Rello request timed out, using cached keys");
      } else {
        console.warn(
          "[PlatformKeyValidator] Rello unreachable, using cached keys:",
          error instanceof Error ? error.message : "unknown error"
        );
      }
    }
  }

  /**
   * Ensure the cache is fresh. Deduplicates concurrent refresh calls
   * so multiple simultaneous requests don't all hit Rello.
   */
  async function ensureFreshCache(): Promise<void> {
    if (Date.now() - lastFetchTime < cacheTtlMs) return;

    if (!fetchInProgress) {
      fetchInProgress = refreshCache().finally(() => {
        fetchInProgress = null;
      });
    }

    await fetchInProgress;
  }

  /**
   * Validate an inbound request.
   * Returns the caller's identity if the token matches a cached key hash,
   * or null if the token is missing, invalid, or not recognized.
   */
  return async function validatePlatformCaller(
    request: Request
  ): Promise<PlatformCaller | null> {
    // Extract Bearer token
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7);
    if (!token) return null;

    // Hash the token with SHA-256 (same algorithm Rello uses)
    const tokenHash = createHash("sha256").update(token).digest("hex");

    // Ensure cache is fresh
    await ensureFreshCache();

    // Find a matching key by hash
    const match = keyCache.find((k) => k.keyHash === tokenHash);
    if (!match) return null;

    return {
      appSource: match.appSource,
      keyId: match.id,
      permissions: match.permissions,
    };
  };
}
