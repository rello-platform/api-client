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
  /**
   * Maximum staleness window beyond TTL expiry during which the validator
   * will serve last-good cache when the upstream Rello service-keys endpoint
   * returns 5xx, network error, or timeout. Past this window the validator
   * fails closed (returns null on every inbound). 4xx responses always
   * fail-closed (no stale-serve) to avoid masking credential drift.
   *
   * Default: 1800000 (30 minutes). Total worst-case stale window =
   * cacheTtlMs + staleServeMaxMs (35 min default).
   *
   * Set to 0 to disable stale-serve (fail-closed on the first 5xx after
   * cache populate — equivalent to v2.10.0 and earlier behavior).
   */
  staleServeMaxMs?: number;
}

/**
 * A cached service key entry fetched from Rello.
 */
interface CachedKey {
  id: string;
  appSource: string;
  keyHash: string;
  // '*' is the platform-wide-key wildcard semantic per CENTRALIZED-API-KEY-MIGRATION Session 2; first-class on the consumed contract.
  permissions: readonly (PermissionSlug | "*")[];
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
  // '*' is the platform-wide-key wildcard semantic per CENTRALIZED-API-KEY-MIGRATION Session 2; first-class on the consumed contract.
  permissions: readonly (PermissionSlug | "*")[];
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
type FetchStatus = "init" | "ok" | "5xx" | "4xx" | "network" | "timeout";

export function createPlatformKeyValidator(
  config: PlatformKeyValidatorConfig
): (request: Request) => Promise<PlatformCaller | null> {
  const baseUrl = config.relloApiUrl.replace(/\/+$/, "").replace(/\/api\/?$/, "");
  const targetApp = config.ownAppSlug.toUpperCase().replace(/-/g, "_");
  const cacheTtlMs = config.cacheTtlMs ?? 5 * 60 * 1000;
  const staleServeMaxMs = config.staleServeMaxMs ?? 30 * 60 * 1000;

  let keyCache: CachedKey[] = [];
  // Time of last refresh ATTEMPT — bumped on every fetch (success or failure).
  // Used by ensureFreshCache to throttle the refresh cadence.
  let lastFetchTime = 0;
  // Time of last SUCCESSFUL refresh — bumped only on a 200 with valid body.
  // Used at the read site to compute staleness for stale-serve eligibility.
  let lastSuccessTime = 0;
  let lastFetchStatus: FetchStatus = "init";
  let staleServeWarningEmitted = false;
  let capExceedWarningEmitted = false;
  let fetchInProgress: Promise<void> | null = null;

  /**
   * Fetch expected keys from Rello.
   * - 200 + valid body → replace cache, mark `ok`, reset emit-once flags.
   * - 5xx → leave cache untouched, mark `5xx` (read site stale-serves if cache populated).
   * - 4xx → leave cache untouched, mark `4xx` (read site fail-closes — masks credential drift if served).
   * - Network error → mark `network`. Timeout → mark `timeout`. Both eligible for stale-serve.
   */
  async function refreshCache(): Promise<void> {
    const url = `${baseUrl}/api/v1/platform/service-keys?targetApp=${encodeURIComponent(targetApp)}`;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${config.relloApiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      });

      lastFetchTime = Date.now();

      if (!res.ok) {
        if (res.status >= 500) {
          lastFetchStatus = "5xx";
          console.warn(
            `[platform-key-validator] Failed to fetch service keys: ${res.status} ${res.statusText} (will stale-serve if cache populated)`
          );
        } else {
          lastFetchStatus = "4xx";
          console.warn(
            `[platform-key-validator] Failed to fetch service keys: ${res.status} ${res.statusText} (4xx — fail-closed; check RELLO_API_KEY for credential drift)`
          );
        }
        return;
      }

      const data = await res.json();
      const keys: unknown[] = data.keys;

      if (!Array.isArray(keys)) {
        // Treat malformed body as upstream failure — preserve cache, allow stale-serve.
        lastFetchStatus = "5xx";
        console.warn("[platform-key-validator] Invalid response: keys is not an array (treating as 5xx)");
        return;
      }

      keyCache = keys.map((k: unknown) => {
        const entry = k as Record<string, unknown>;
        return {
          id: String(entry.id ?? ""),
          appSource: String(entry.appSource ?? ""),
          keyHash: String(entry.keyHash ?? ""),
          permissions: Array.isArray(entry.permissions)
            ? (entry.permissions.map(String) as (PermissionSlug | "*")[])
            : [],
        };
      });

      lastSuccessTime = lastFetchTime;
      lastFetchStatus = "ok";
      // Recovery — reset emit-once gates so future failures warn fresh.
      staleServeWarningEmitted = false;
      capExceedWarningEmitted = false;
    } catch (error) {
      lastFetchTime = Date.now();
      if (error instanceof DOMException && error.name === "AbortError") {
        lastFetchStatus = "timeout";
        console.warn("[platform-key-validator] Rello request timed out (will stale-serve if cache populated)");
      } else {
        lastFetchStatus = "network";
        console.warn(
          "[platform-key-validator] Rello unreachable (will stale-serve if cache populated):",
          error instanceof Error ? error.message : "unknown error"
        );
      }
    }
  }

  /**
   * Ensure the cache is fresh. Deduplicates concurrent refresh calls
   * so multiple simultaneous requests don't all hit Rello.
   *
   * `lastFetchTime` is bumped on every attempt (success or failure), so the
   * refresh cadence is preserved at `cacheTtlMs` regardless of upstream state.
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

    // Stale-serve decision tree.
    // Pre-first-success → fail-closed (no cache to serve). Same as v2.10.0.
    if (lastSuccessTime === 0) return null;

    // 4xx fetch failure → fail-closed (don't mask credential drift).
    if (lastFetchStatus === "4xx") return null;

    // Upstream is degraded (5xx / network / timeout) and cache is populated:
    // stale-serve up to cacheTtlMs + staleServeMaxMs since last success, then fail-closed.
    if (
      lastFetchStatus === "5xx" ||
      lastFetchStatus === "network" ||
      lastFetchStatus === "timeout"
    ) {
      const staleAgeMs = Date.now() - lastSuccessTime;
      const capMs = cacheTtlMs + staleServeMaxMs;
      if (staleAgeMs > capMs) {
        if (!capExceedWarningEmitted) {
          console.warn(
            `[platform-key-validator] WARN cache exceeded stale-serve cap age_ms=${staleAgeMs} capMs=${capMs} reason=upstream-${lastFetchStatus} — fail-closed until next successful refresh`
          );
          capExceedWarningEmitted = true;
        }
        return null;
      }
      if (!staleServeWarningEmitted) {
        console.warn(
          `[platform-key-validator] WARN serving stale cache age_ms=${staleAgeMs} reason=upstream-${lastFetchStatus}`
        );
        staleServeWarningEmitted = true;
      }
    }

    // Find a matching key by hash
    const match = keyCache.find((k) => k.keyHash === tokenHash);
    if (!match) return null;

    // Fire-and-forget bump of ApiKey.lastUsedAt on Rello — observational only,
    // never block auth on the write. Mirrors the legacy validateApiKey()
    // fire-and-forget pattern at Rello/src/lib/auth/api-key.ts:71-76.
    void (async () => {
      try {
        await fetch(`${baseUrl}/api/v1/platform/service-keys/touch`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.relloApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ keyId: match.id }),
          signal: AbortSignal.timeout(5_000),
        });
      } catch (error) {
        console.warn(
          "[PlatformKeyValidator] Failed to record key touch:",
          error instanceof Error ? error.message : "unknown error"
        );
      }
    })();

    return {
      appSource: match.appSource,
      keyId: match.id,
      permissions: match.permissions,
    };
  };
}

/**
 * Returns true if the caller has the platform-wide wildcard permission
 * OR the specific required permission. Centralizes the wildcard-OR-specific
 * pattern that 9 consumer repos previously duplicated locally.
 */
export function callerHasPermission(
  caller: PlatformCaller,
  required: PermissionSlug,
): boolean {
  if (caller.permissions.includes("*")) return true;
  return caller.permissions.includes(required);
}

/**
 * Configuration for the service Bearer guard factory.
 */
export interface ServiceBearerGuardConfig {
  /**
   * Resolves the validator at call time. Returning null fails-closed with
   * `BEARER_UNAVAILABLE` (env misconfig, etc.). Each consumer wires this to
   * their existing lazy-singleton `getValidator()` (typically built from
   * `createPlatformKeyValidator` with the spoke's own `OWN_APP_SLUG` /
   * env-var reads).
   */
  getValidator: () => ((request: Request) => Promise<PlatformCaller | null>) | null;
}

/**
 * Create a fail-closed Bearer-only auth guard for inbound service-to-service
 * routes. Returned function takes the inbound request + the required
 * permission, validates the Bearer hash against Rello's ApiKey table via the
 * configured validator, and returns either:
 *   - `PlatformCaller` on success
 *   - `Response` (401/403) the route handler should return verbatim
 *
 * Standard `Response` (not `NextResponse`) is returned so this helper stays
 * framework-agnostic — Next.js route handlers accept standard Response
 * returns, and `instanceof Response` matches both Response and NextResponse.
 *
 * Replaces per-spoke duplication of the same shape (NS Phase 5b
 * `requireServiceBearer`, etc.). Closes the SHAPE-01-class env-var Bearer
 * bypass on every spoke's inbound service surface — see Platform CLAUDE.md
 * §Inter-App Auth: "NEVER add a `process.env.FOO_SECRET` Bearer-compare
 * fallback alongside the ApiKey path."
 *
 * @example
 *   // Spoke-side wiring (mirrors NS's pre-canonical local impl):
 *   import { createServiceBearerGuard, createPlatformKeyValidator, getRelloBaseUrl } from "@rello-platform/api-client";
 *
 *   let _validator = null;
 *   function getValidator() {
 *     if (_validator) return _validator;
 *     const url = getRelloBaseUrl();
 *     const key = process.env.RELLO_API_KEY;
 *     if (!url || !key) return null;
 *     _validator = createPlatformKeyValidator({ relloApiUrl: url, relloApiKey: key, ownAppSlug: "harvest-home" });
 *     return _validator;
 *   }
 *
 *   export const requireServiceBearer = createServiceBearerGuard({ getValidator });
 *
 *   // Route handler:
 *   const auth = await requireServiceBearer(request, { permission: PERMISSIONS.PROVISIONING_WRITE.slug });
 *   if (auth instanceof Response) return auth;
 *   // auth is PlatformCaller — use auth.appSource / auth.keyId for logging.
 */
export function createServiceBearerGuard(
  config: ServiceBearerGuardConfig,
): (request: Request, opts: { permission: PermissionSlug }) => Promise<PlatformCaller | Response> {
  return async function requireServiceBearer(
    request: Request,
    opts: { permission: PermissionSlug },
  ): Promise<PlatformCaller | Response> {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse(
        { success: false, error: "Missing Bearer token", code: "BEARER_MISSING" },
        401,
      );
    }

    const validator = config.getValidator();
    if (!validator) {
      return jsonResponse(
        {
          success: false,
          error: "Bearer auth is misconfigured on this service.",
          code: "BEARER_UNAVAILABLE",
        },
        401,
      );
    }

    let caller: PlatformCaller | null;
    try {
      caller = await validator(request);
    } catch (err) {
      const path = safePath(request);
      console.error(
        `[platform-key-validator] Validator threw while resolving service Bearer on ${request.method} ${path}:`,
        err,
      );
      return jsonResponse(
        {
          success: false,
          error: "Bearer validation failed.",
          code: "BEARER_VALIDATION_ERROR",
        },
        401,
      );
    }

    if (!caller) {
      return jsonResponse(
        {
          success: false,
          error: "Invalid or expired Bearer token.",
          code: "BEARER_INVALID",
        },
        401,
      );
    }

    if (!callerHasPermission(caller, opts.permission)) {
      const path = safePath(request);
      console.warn(
        `[platform-key-validator] Caller ${caller.appSource} (key ${caller.keyId}) ` +
          `lacks "${opts.permission}" on ${request.method} ${path}. ` +
          `Held permissions: ${caller.permissions.join(", ") || "(none)"}.`,
      );
      return jsonResponse(
        {
          success: false,
          error: `Missing required permission: ${opts.permission}`,
          code: "PERMISSION_DENIED",
        },
        403,
      );
    }

    return caller;
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function safePath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "(unknown)";
  }
}
