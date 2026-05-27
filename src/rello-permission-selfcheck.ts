import type { PermissionSlug } from "@rello-platform/permissions";

/**
 * Deploy-time spoke→Rello permission self-check (SPEC-SPOKE-RELLO-KEY-PERMISSION-SELFCHECK).
 *
 * The OUTBOUND counterpart to `createPlatformKeyValidator` (inbound). A spoke calls
 * Rello's `GET /api/v1/platform/service-keys/self` with its own wired
 * `<SPOKE>_TO_RELLO_API_KEY` and asserts, at deploy time, that the key (a) resolves
 * to its own `<spoke>→RELLO` pair and (b) carries every permission slug its code's
 * Rello calls require — killing the silent-403 drift class (HR's key 403'd lead sync
 * for ~18 days; NS dead-lettered since 2026-04-23, both because key and code drifted
 * independently and nothing failed until the path was first exercised).
 *
 * This module owns only the diff MECHANISM; the per-repo `REQUIRED_RELLO_PERMISSIONS`
 * data lives in each spoke (B-03). It reuses the same base-URL normalizer,
 * `AbortSignal.timeout(10_000)`, and 4xx-vs-5xx/network classification as
 * `createPlatformKeyValidator`, applied in the outbound direction.
 */

/** Minimal-disclosure body returned by `GET /api/v1/platform/service-keys/self`. */
interface ServiceKeySelfBody {
  keyId: string;
  appSource: string | null;
  targetApp: string | null;
  permissions: string[];
  tenantId: string | null;
}

export interface RelloPermissionSelfCheckConfig {
  /** Rello API base URL (domain root; must NOT include "/api"). Normalized like createPlatformKeyValidator. */
  relloApiUrl: string;
  /** The wired `<SPOKE>_TO_RELLO_API_KEY` value to validate (the same value the production client resolves). */
  relloApiKey: string;
  /** This spoke's expected appSource — UPPER_SNAKE or kebab; normalized before the pair assertion. */
  ownAppSource: string;
  /** The spoke's `REQUIRED_RELLO_PERMISSIONS` — slugs from `@rello-platform/permissions`, never hand-typed. */
  requiredPermissions: readonly PermissionSlug[];
  /** Fetch timeout in ms. Default 10_000 (mirrors createPlatformKeyValidator). */
  timeoutMs?: number;
}

export type SelfCheckResult =
  | { ok: true; keyId: string; appSource: string; permissions: PermissionSlug[] }
  | { ok: false; class: "missing-permissions"; keyId: string; missing: PermissionSlug[] }
  | { ok: false; class: "wrong-pair"; expected: string; actual: string }
  // 401 — empty / unknown / revoked wired value (a real wiring defect).
  | { ok: false; class: "invalid-key" }
  // 5xx / network / timeout / route-absent (404): never block a deploy on Rello uptime.
  | { ok: false; class: "rello-unreachable"; status: number | "network" | "timeout" };

/** Normalize an appSource identifier to the stored UPPER_SNAKE form for pair comparison. */
function toUpperSnake(raw: string): string {
  return raw.toUpperCase().replace(/-/g, "_");
}

/**
 * Run the self-check once and classify the result. Never throws — every failure
 * mode maps to a `SelfCheckResult` so the caller (a deploy-time runner) decides
 * exit posture. `rello-unreachable` is the fail-safe bucket (exit 0, never block).
 */
export async function runRelloPermissionSelfCheck(
  config: RelloPermissionSelfCheckConfig
): Promise<SelfCheckResult> {
  const baseUrl = config.relloApiUrl.replace(/\/+$/, "").replace(/\/api\/?$/, "");
  const url = `${baseUrl}/api/v1/platform/service-keys/self`;
  const timeoutMs = config.timeoutMs ?? 10_000;

  // An empty wired key can never authenticate — classify locally without a round-trip
  // (Rule: the runner detects empty env → invalid-key, provable with no Rello needed).
  if (!config.relloApiKey) {
    return { ok: false, class: "invalid-key" };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.relloApiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, class: "rello-unreachable", status: "timeout" };
    }
    return { ok: false, class: "rello-unreachable", status: "network" };
  }

  if (!res.ok) {
    // 401 is the only credential-drift signal this route emits (empty/unknown/revoked
    // key). Everything else — 5xx, a 503 deploy-thrash, or a 404 (G1 route not yet
    // deployed / reverted) — is "unreachable": log + exit 0, never couple a spoke
    // deploy to Rello state (mirrors the validator's stale-serve rationale + the
    // spec's rollback fail-safe).
    if (res.status === 401) {
      return { ok: false, class: "invalid-key" };
    }
    return { ok: false, class: "rello-unreachable", status: res.status };
  }

  let body: ServiceKeySelfBody;
  try {
    body = (await res.json()) as ServiceKeySelfBody;
  } catch {
    // Malformed 200 body — treat as upstream failure, never block the deploy.
    return { ok: false, class: "rello-unreachable", status: res.status };
  }

  if (typeof body?.keyId !== "string" || typeof body?.appSource !== "string") {
    return { ok: false, class: "rello-unreachable", status: res.status };
  }

  // Pair assertion first — a wrong-pair key is the wrong key entirely; its
  // permissions are irrelevant (catches the Oven inbound-key wiring-defect class).
  const expected = toUpperSnake(config.ownAppSource);
  const actual = toUpperSnake(body.appSource);
  if (expected !== actual) {
    return { ok: false, class: "wrong-pair", expected, actual };
  }

  // `"*"` is the platform-wide-key wildcard the inbound validator already treats
  // first-class (platform-key-validator.ts:43-44) — it satisfies every required slug.
  const returned = body.permissions ?? [];
  const hasWildcard = returned.includes("*");
  const missing = config.requiredPermissions.filter(
    (p) => !hasWildcard && !returned.includes(p)
  );
  if (missing.length > 0) {
    return { ok: false, class: "missing-permissions", keyId: body.keyId, missing: [...missing] };
  }

  return {
    ok: true,
    keyId: body.keyId,
    appSource: body.appSource,
    permissions: returned as PermissionSlug[],
  };
}

/**
 * Factory mirroring `createPlatformKeyValidator`'s shape: binds config once and
 * returns a zero-arg runner. Spokes whose runner script captures config at module
 * scope can use either this or `runRelloPermissionSelfCheck` directly.
 */
export function createRelloPermissionSelfCheck(
  config: RelloPermissionSelfCheckConfig
): () => Promise<SelfCheckResult> {
  return () => runRelloPermissionSelfCheck(config);
}
