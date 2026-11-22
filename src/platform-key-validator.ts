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
   * returns 5xx, a 4xx other than 401/403, network error, or timeout. Past
   * this window the validator fails closed (returns null on every inbound).
   * 401 and 403 always fail closed (no stale-serve): they are the only
   * answers about OUR credential, and serving past them would mask credential
   * drift. Any other 4xx (409, 404, 429, …) is an unknown from something
   * between us and Rello — measured 2026-09-29: an edge 409 that never reached
   * Rello's app — and is treated like a 5xx (since 2.28.1).
   *
   * Default: 1800000 (30 minutes). Total worst-case stale window =
   * cacheTtlMs + staleServeMaxMs (35 min default).
   *
   * Set to 0 to disable stale-serve (fail-closed on the first 5xx after
   * cache populate — equivalent to v2.10.0 and earlier behavior).
   */
  staleServeMaxMs?: number;
  /**
   * How a successful check reports key usage to Rello (since 2.46.0).
   * Omitted = `{ mode: "per-request" }`, the behaviour of every earlier
   * version: one `POST /api/v1/platform/service-keys/touch` per successful
   * check. See `PlatformKeyUsageConfig`.
   */
  usage?: PlatformKeyUsageConfig;
}

/**
 * Usage reporting (since 2.46.0; plan PLATFORM-TRACKING-SYSTEM §9.1).
 *
 * - `"per-request"` (default): unchanged. Every successful check fires one
 *   `/service-keys/touch`, cache hits included, and Rello writes
 *   `ApiKey.lastUsedAt` each time.
 * - `"batched"`: a successful check adds `keyId → count` to an in-memory map
 *   and makes NO request. `validator.flushUsage()` sends every pending key in
 *   ONE `POST /api/v1/platform/service-keys/touch-batch`. Nothing pending
 *   sends nothing. A non-2xx answer or a network failure puts the counts back
 *   for the next window. The map only ever holds ids of keys in the current
 *   registry, so it is bounded by the registered key count.
 *
 * The flush is driven by requests, never by a timer: the first successful
 * check at least `windowMs` after the last flush attempt (or after the
 * validator was created) that falls inside a platform anchor window hands
 * `flushUsage()` to `defer`. An idle isolate sends nothing. Counts still held
 * when an isolate dies are lost; they only feed an observability counter.
 *
 * In `"batched"` mode the registry refresh honours the same alignment: once
 * `cacheTtlMs` has passed it refreshes at the next anchor window and serves
 * the cached keys until then. A validator that has never loaded the registry
 * still fetches at once.
 */
export interface PlatformKeyUsageConfig {
  mode: "per-request" | "batched";
  /** Minimum time between flush attempts. Default 900000 (15 min). Batched mode only. */
  windowMs?: number;
  /**
   * Flush, and refresh the registry after its TTL, only inside the platform
   * anchor windows (UTC minutes :00–04, :15–19, :30–34, :45–49 — the windows
   * Rello's `auth-buffer-flush` drain runs in), so the shared hub can sleep
   * between them. Default true. Batched mode only.
   */
  alignToAnchorWindows?: boolean;
  /**
   * Receives the flush promise so the runtime keeps it alive after the
   * response returns. On a Cloudflare Worker this must be `ctx.waitUntil`:
   * a bare promise is cancelled when the response is sent. Because a Worker's
   * `ctx` belongs to one request, prefer passing it per call —
   * `validator(request, { defer: (p) => ctx.waitUntil(p) })` — which overrides
   * this one. Omitted on both: the promise is left to run on its own.
   */
  defer?: (p: Promise<unknown>) => void;
}

/** Outcome of one `flushUsage()` call. Each case keeps its own value. */
export type UsageFlushOutcome =
  /** Per-request mode: there is never anything to flush. */
  | "disabled"
  /** Nothing was pending; no request was made. */
  | "empty"
  /** Rello answered 2xx; the sent counts are gone from the map. */
  | "sent"
  /** Non-2xx or no answer; every sent count was put back for the next window. */
  | "failed";

export interface UsageFlushResult {
  outcome: UsageFlushOutcome;
  /** Entries in the request body (0 when no request was made). */
  entries: number;
  /** Sum of the counts in the request body. */
  total: number;
  /** HTTP status of the answer; null when no request was made or none came back. */
  httpStatus: number | null;
}

/** Rello's `touch-batch` limits; a flush never sends more in one request. */
const TOUCH_BATCH_MAX_ENTRIES = 500;
const TOUCH_BATCH_MAX_COUNT = 1_000_000;

/**
 * True inside a platform anchor window: UTC minutes :00–04, :15–19, :30–34,
 * :45–49 (Rello `src/trigger/auth-buffer-flush.ts`, cadence `2,17,32,47`).
 */
export function isInAnchorWindow(epochMs: number): boolean {
  return new Date(epochMs).getUTCMinutes() % 15 < 5;
}

/**
 * A cached service key entry fetched from Rello.
 */
export interface CachedKey {
  id: string;
  appSource: string;
  keyHash: string;
  // '*' is the platform-wide-key wildcard semantic per CENTRALIZED-API-KEY-MIGRATION Session 2; first-class on the consumed contract.
  permissions: readonly (PermissionSlug | "*")[];
  /**
   * `ApiKey.tenantId` as the registry answered it (since 2.46.0).
   * - a string → the key is scoped to that tenant;
   * - `null`   → the registry said the key has no tenant (platform scope);
   * - `undefined` → the answer carried no usable `tenantId` field (an older
   *   Rello, or a malformed value): scope UNKNOWN. Never read it as platform
   *   scope (`unknown-is-not-absent`). See `callerTenantScope`.
   */
  tenantId: string | null | undefined;
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
  /**
   * The key's tenant, from the credential only (since 2.46.0): a string =
   * tenant scope, `null` = platform scope, `undefined` = UNKNOWN (the
   * registry answer had no `tenantId`). Same meaning as `CachedKey.tenantId`.
   */
  tenantId: string | null | undefined;
}

/** A caller's scope, with unknown kept apart from platform. */
export type CallerTenantScope =
  | { kind: "tenant"; tenantId: string }
  | { kind: "platform" }
  | { kind: "unknown" };

/**
 * Reads a caller's scope from its credential. `undefined` is `unknown`,
 * never `platform`: a missing field must not grant platform scope.
 */
export function callerTenantScope(caller: Pick<PlatformCaller, "tenantId">): CallerTenantScope {
  if (typeof caller.tenantId === "string") return { kind: "tenant", tenantId: caller.tenantId };
  if (caller.tenantId === null) return { kind: "platform" };
  return { kind: "unknown" };
}

/** Per-call options for the validator (since 2.46.0). */
export interface ValidateCallOptions {
  /** Overrides `usage.defer` for a flush this call starts (a Worker passes its own request's `ctx.waitUntil`). */
  defer?: (p: Promise<unknown>) => void;
}

/** Reads `tenantId` from one registry entry: a non-empty string, null, or undefined (unknown). */
function readTenantId(entry: Record<string, unknown>): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(entry, "tenantId")) return undefined;
  const v = entry.tenantId;
  if (v === null) return null;
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

/**
 * Why a validator call returned null (since 2.28.1).
 *
 * - `no-bearer`          — the request carried no `Authorization: Bearer <token>`.
 * - `no-key-match`       — the cache is usable and no cached key hash matches the token.
 * - `auth-refused`       — the last refresh got 401/403: every token is refused until a refresh succeeds.
 * - `no-cache`           — no refresh has ever succeeded, so there is nothing to match against.
 * - `stale-cap-exceeded` — upstream has been failing past `cacheTtlMs + staleServeMaxMs`.
 *
 * Only `no-key-match` and `no-bearer` are about the inbound token. The other
 * three mean the validator refused every token, whatever it was.
 */
export type ValidatorNullReason =
  | "no-bearer"
  | "no-key-match"
  | "auth-refused"
  | "no-cache"
  | "stale-cap-exceeded";

export interface ValidatorNullReport {
  reason: ValidatorNullReason;
  /** HTTP status of the last failed key refresh, when the reason is a refusal and one is known; else null. */
  httpStatus: number | null;
}

/**
 * The validator returned by `createPlatformKeyValidator`: call it with the
 * inbound Request, exactly as before. `reasonFor(request)` then reports why
 * that same Request got null (undefined if it got a caller or was never
 * validated). Read-only: it never changes what the call returns. Keyed by the
 * Request object, so concurrent requests never see each other's reason.
 */
export type PlatformKeyValidator = ((
  request: Request,
  options?: ValidateCallOptions
) => Promise<PlatformCaller | null>) & {
  reasonFor(request: Request): ValidatorNullReport | undefined;
  /**
   * Batched mode: send every pending usage count in one
   * `/service-keys/touch-batch` request (since 2.46.0). Never rejects. A
   * call while a flush is in flight returns that flush. Per-request mode:
   * resolves `{ outcome: "disabled" }` and sends nothing.
   */
  flushUsage(): Promise<UsageFlushResult>;
};

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
// `auth-refused` = 401/403, the only answers about our credential (fail closed).
// `4xx-other` = any other 4xx: an unknown, stale-served like 5xx. Each failure
// class keeps its own value so a log or a branch can never confuse them.
type FetchStatus = "init" | "ok" | "5xx" | "auth-refused" | "4xx-other" | "network" | "timeout";

export function createPlatformKeyValidator(
  config: PlatformKeyValidatorConfig
): PlatformKeyValidator {
  const baseUrl = config.relloApiUrl.replace(/\/+$/, "").replace(/\/api\/?$/, "");
  const targetApp = config.ownAppSlug.toUpperCase().replace(/-/g, "_");
  const cacheTtlMs = config.cacheTtlMs ?? 5 * 60 * 1000;
  const staleServeMaxMs = config.staleServeMaxMs ?? 30 * 60 * 1000;
  const batched = config.usage?.mode === "batched";
  const usageWindowMs = config.usage?.windowMs ?? 15 * 60 * 1000;
  const alignToAnchor = batched && (config.usage?.alignToAnchorWindows ?? true);
  const configDefer = config.usage?.defer;

  // Batched usage: keyId → successful checks not yet acknowledged by Rello.
  // Only ids in the current registry ever enter it (see refreshCache's prune).
  const pendingUsage = new Map<string, number>();
  // Time of the last flush ATTEMPT (started by a check). Starts at creation,
  // so the first flush comes one window after the validator is built.
  let lastFlushAttemptAt = Date.now();
  let flushInProgress: Promise<UsageFlushResult> | null = null;

  let keyCache: CachedKey[] = [];
  // Time of last refresh ATTEMPT — bumped on every fetch (success or failure).
  // Used by ensureFreshCache to throttle the refresh cadence.
  let lastFetchTime = 0;
  // Time of last SUCCESSFUL refresh — bumped only on a 200 with valid body.
  // Used at the read site to compute staleness for stale-serve eligibility.
  let lastSuccessTime = 0;
  let lastFetchStatus: FetchStatus = "init";
  // HTTP status of the last failed refresh (null for network/timeout/ok), so
  // the stale-serve and cap warnings name the real status, not just its class.
  let lastFetchHttpStatus: number | null = null;
  let staleServeWarningEmitted = false;
  let capExceedWarningEmitted = false;
  let fetchInProgress: Promise<void> | null = null;

  /**
   * Fetch expected keys from Rello.
   * - 200 + valid body → replace cache, mark `ok`, reset emit-once flags.
   * - 5xx → leave cache untouched, mark `5xx` (read site stale-serves if cache populated).
   * - 401/403 → leave cache untouched, mark `auth-refused` (read site fail-closes — serving would mask credential drift).
   * - Any other 4xx → leave cache untouched, mark `4xx-other` (read site stale-serves like 5xx — not an answer about our credential).
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
        lastFetchHttpStatus = res.status;
        if (res.status >= 500) {
          lastFetchStatus = "5xx";
          console.warn(
            `[platform-key-validator] Failed to fetch service keys: ${res.status} ${res.statusText} (will stale-serve if cache populated)`
          );
        } else if (res.status === 401 || res.status === 403) {
          lastFetchStatus = "auth-refused";
          console.warn(
            `[platform-key-validator] Failed to fetch service keys: ${res.status} ${res.statusText} (4xx auth refusal — fail-closed; check RELLO_API_KEY for credential drift)`
          );
        } else {
          lastFetchStatus = "4xx-other";
          console.warn(
            `[platform-key-validator] Failed to fetch service keys: ${res.status} ${res.statusText} (4xx, not an answer about our credential — will stale-serve if cache populated)`
          );
        }
        return;
      }

      const data = await res.json();
      const keys: unknown[] = data.keys;

      if (!Array.isArray(keys)) {
        // Treat malformed body as upstream failure — preserve cache, allow stale-serve.
        lastFetchStatus = "5xx";
        lastFetchHttpStatus = null;
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
          tenantId: readTenantId(entry),
        };
      });

      // Keep the usage map bounded by the registry: a key Rello no longer
      // lists (revoked, expired, retargeted) can gain no new counts, so its
      // pending counts are dropped here, and said so.
      if (pendingUsage.size > 0) {
        const registered = new Set(keyCache.map((k) => k.id));
        let droppedKeys = 0;
        let droppedCount = 0;
        for (const [keyId, count] of pendingUsage) {
          if (!registered.has(keyId)) {
            pendingUsage.delete(keyId);
            droppedKeys += 1;
            droppedCount += count;
          }
        }
        if (droppedKeys > 0) {
          console.warn(
            `[platform-key-validator] dropped pending usage for ${droppedKeys} key(s) no longer in the registry (count=${droppedCount})`
          );
        }
      }

      lastSuccessTime = lastFetchTime;
      lastFetchStatus = "ok";
      lastFetchHttpStatus = null;
      // Recovery — reset emit-once gates so future failures warn fresh.
      staleServeWarningEmitted = false;
      capExceedWarningEmitted = false;
    } catch (error) {
      lastFetchTime = Date.now();
      lastFetchHttpStatus = null;
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
    const now = Date.now();
    if (now - lastFetchTime < cacheTtlMs) return;
    // Batched + aligned: past the TTL, a validator that has loaded the
    // registry waits for the next anchor window and serves its cached keys
    // until then. One that never loaded it (a cold isolate) fetches at once.
    if (alignToAnchor && lastSuccessTime !== 0 && !isInAnchorWindow(now)) return;

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
  // Why each Request got null. A WeakMap keyed by the Request object, not a
  // shared "last reason" field: concurrent requests must not read each
  // other's reason, and entries go away with their requests.
  const nullReasons = new WeakMap<Request, ValidatorNullReport>();
  function refuse(request: Request, reason: ValidatorNullReason, withStatus: boolean): null {
    nullReasons.set(request, { reason, httpStatus: withStatus ? lastFetchHttpStatus : null });
    return null;
  }

  /**
   * Send every pending count in one touch-batch request. Takes the counts out
   * of the map first, so checks that land during the request start fresh
   * counts; on any failure the taken counts are added back. Never rejects.
   */
  async function sendPendingUsage(): Promise<UsageFlushResult> {
    if (pendingUsage.size === 0) {
      return { outcome: "empty", entries: 0, total: 0, httpStatus: null };
    }
    const entries: { keyId: string; count: number }[] = [];
    for (const [keyId, count] of pendingUsage) {
      if (entries.length >= TOUCH_BATCH_MAX_ENTRIES) break;
      const sent = Math.min(count, TOUCH_BATCH_MAX_COUNT);
      entries.push({ keyId, count: sent });
      // Anything over Rello's per-entry cap stays pending for the next window.
      if (count > sent) pendingUsage.set(keyId, count - sent);
      else pendingUsage.delete(keyId);
    }
    const total = entries.reduce((sum, e) => sum + e.count, 0);
    const putBack = () => {
      for (const e of entries) pendingUsage.set(e.keyId, (pendingUsage.get(e.keyId) ?? 0) + e.count);
    };
    try {
      const res = await fetch(`${baseUrl}/api/v1/platform/service-keys/touch-batch`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.relloApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ entries }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        putBack();
        console.warn(
          `[platform-key-validator] usage flush refused: ${res.status} — kept ${entries.length} key(s), count=${total}, for the next window`
        );
        return { outcome: "failed", entries: entries.length, total, httpStatus: res.status };
      }
      return { outcome: "sent", entries: entries.length, total, httpStatus: res.status };
    } catch (error) {
      putBack();
      console.warn(
        `[platform-key-validator] usage flush got no answer — kept ${entries.length} key(s), count=${total}, for the next window:`,
        error instanceof Error ? error.message : "unknown error"
      );
      return { outcome: "failed", entries: entries.length, total, httpStatus: null };
    }
  }

  function flushUsage(): Promise<UsageFlushResult> {
    if (!batched) {
      return Promise.resolve({ outcome: "disabled", entries: 0, total: 0, httpStatus: null });
    }
    if (!flushInProgress) {
      flushInProgress = sendPendingUsage().finally(() => {
        flushInProgress = null;
      });
    }
    return flushInProgress;
  }

  /** Called after a successful batched check: start a flush when one is due. */
  function maybeStartFlush(defer: ((p: Promise<unknown>) => void) | undefined): void {
    const now = Date.now();
    if (now - lastFlushAttemptAt < usageWindowMs) return;
    if (alignToAnchor && !isInAnchorWindow(now)) return;
    if (flushInProgress) return;
    lastFlushAttemptAt = now;
    const p = flushUsage();
    if (!defer) return; // flushUsage never rejects, so a bare promise is safe
    try {
      defer(p);
    } catch (error) {
      console.warn(
        "[platform-key-validator] defer threw; the usage flush runs without it:",
        error instanceof Error ? error.message : "unknown error"
      );
    }
  }

  const validatePlatformCaller = async function validatePlatformCaller(
    request: Request,
    options?: ValidateCallOptions
  ): Promise<PlatformCaller | null> {
    nullReasons.delete(request);
    // Extract Bearer token
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return refuse(request, "no-bearer", false);
    const token = authHeader.slice(7);
    if (!token) return refuse(request, "no-bearer", false);

    // Hash the token with SHA-256 (same algorithm Rello uses)
    const tokenHash = createHash("sha256").update(token).digest("hex");

    // Ensure cache is fresh
    await ensureFreshCache();

    // Stale-serve decision tree.
    // Pre-first-success → fail-closed (no cache to serve). Same as v2.10.0.
    if (lastSuccessTime === 0) return refuse(request, "no-cache", true);

    // 401/403 → fail-closed: the only answers about our credential, and
    // serving past them would mask credential drift.
    if (lastFetchStatus === "auth-refused") return refuse(request, "auth-refused", true);

    // Upstream is degraded (5xx / other 4xx / network / timeout) and cache is
    // populated: stale-serve up to cacheTtlMs + staleServeMaxMs since last
    // success, then fail-closed.
    if (
      lastFetchStatus === "5xx" ||
      lastFetchStatus === "4xx-other" ||
      lastFetchStatus === "network" ||
      lastFetchStatus === "timeout"
    ) {
      const staleAgeMs = Date.now() - lastSuccessTime;
      const capMs = cacheTtlMs + staleServeMaxMs;
      const statusPart = lastFetchHttpStatus === null ? "" : ` status=${lastFetchHttpStatus}`;
      if (staleAgeMs > capMs) {
        if (!capExceedWarningEmitted) {
          console.warn(
            `[platform-key-validator] WARN cache exceeded stale-serve cap age_ms=${staleAgeMs} capMs=${capMs} reason=upstream-${lastFetchStatus}${statusPart} — fail-closed until next successful refresh`
          );
          capExceedWarningEmitted = true;
        }
        return refuse(request, "stale-cap-exceeded", true);
      }
      if (!staleServeWarningEmitted) {
        console.warn(
          `[platform-key-validator] WARN serving stale cache age_ms=${staleAgeMs} reason=upstream-${lastFetchStatus}${statusPart}`
        );
        staleServeWarningEmitted = true;
      }
    }

    // Find a matching key by hash
    const match = keyCache.find((k) => k.keyHash === tokenHash);
    if (!match) return refuse(request, "no-key-match", false);

    const caller: PlatformCaller = {
      appSource: match.appSource,
      keyId: match.id,
      permissions: match.permissions,
      tenantId: match.tenantId,
    };

    if (batched) {
      // Batched: count it, make no request; a due flush rides this check.
      pendingUsage.set(match.id, (pendingUsage.get(match.id) ?? 0) + 1);
      maybeStartFlush(options?.defer ?? configDefer);
      return caller;
    }

    // Per-request (default, unchanged): fire-and-forget bump of
    // ApiKey.lastUsedAt on Rello — observational only, never block auth on
    // the write. Mirrors the legacy validateApiKey() fire-and-forget pattern
    // at Rello/src/lib/auth/api-key.ts:71-76.
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

    return caller;
  };

  return Object.assign(validatePlatformCaller, {
    reasonFor: (request: Request): ValidatorNullReport | undefined => nullReasons.get(request),
    flushUsage,
  });
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
