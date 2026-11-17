/**
 * PFP Gateway P-1: Rello's tenant-bound v1 billing reads (SPEC-PFP-GATEWAY.md
 * §4.2 "Read-through on unknown"; Platform KA prompt 1221, rulings 1220/1247).
 * One contract for Rello's routes and PathfinderPro's callers.
 *
 *   GET /api/v1/billing/plan-grants   permission billing:plan-grants:read
 *
 * Auth: `Authorization: Bearer <ApiKey>` (Rello's ApiKey table, targetApp RELLO)
 * with the route's permission, then §4.2's tenant match (Rello's
 * `requireV1TenantMatch`). The tenant is the key's own, or `X-Tenant-Id` for a
 * tenant-null key; never a body. The answers are flat JSON (no
 * `{ success, data }` envelope).
 */
import { z } from "zod";
import { tenantCyrStateSchema } from "./provisioning.js";

// ─── The tenant match refusals (403, shared by every route that runs it) ────

/**
 * §4.2's three tenant 403 bodies, `{ error }`. They are textually distinct on
 * purpose: one status code, three different causes. A permission 403 is the
 * bare `{ error: "Forbidden" }` from requireV1Auth.
 */
export const V1_TENANT_MATCH_ERRORS = Object.freeze({
  /** A tenant-scoped key sent an X-Tenant-Id naming another tenant. Nothing was read for either. */
  tenantHeaderMismatch: "Forbidden — tenant header does not match credential",
  /** The key's app is not one these routes serve (pathfinder-pro today). */
  callerAppNotAllowed: "Forbidden — caller app not allowed",
} as const);

/**
 * The third tenant 403: a tenant-null key whose app is not enabled on the
 * X-Tenant-Id tenant. PathfinderPro resolves it as UNKNOWN (503 with retry),
 * never as "no grants": the app may be enabled a moment later.
 */
export function appNotEnabledForTenantError(appSlug: string): string {
  return `Forbidden — app '${appSlug}' is not enabled for tenant`;
}

export const v1TenantMatchErrorSchema = z.object({ error: z.string().min(1) });
export type V1TenantMatchError = z.infer<typeof v1TenantMatchErrorSchema>;

// ─── GET /api/v1/billing/plan-grants ────────────────────────────────────────

/**
 * 200. `rev` is Rello's TenantPlanGrantState revision (a BIGINT, served as a
 * safe integer; Rello answers 503 rather than round one it can't carry).
 * `cyr` is REQUIRED and nullable: the tenant's effective Check Your Rate record
 * (spec §4.3, the same fields as `billing.addon_changed`), or `null` when the
 * tenant never held Check Your Rate. A body with no `cyr` key is not this
 * answer, and must not be read as "never held" (A-286).
 */
export const planGrantsReadResponseSchema = z.object({
  rev: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  grants: z.array(z.string().min(1)),
  planSlug: z.string().min(1),
  cyr: tenantCyrStateSchema.nullable(),
});
export type PlanGrantsReadResponse = z.infer<typeof planGrantsReadResponseSchema>;

/**
 * The read's own refusals, besides the tenant 403s and requireV1Auth's 401/403:
 *  - 404 `no_plan_grants`: the read succeeded and the tenant has no grant state.
 *    For a gateway-origin tenant that is a contract violation (Rello writes the
 *    marker and the state together); the caller still treats it as unknown.
 *  - 503 `plan_grants_unavailable`: Rello could not read the state, or holds a
 *    row it cannot serve. Unknown: retry, never "no grants".
 */
export const PLAN_GRANTS_READ_ERROR_CODES = ["no_plan_grants", "plan_grants_unavailable"] as const;
export type PlanGrantsReadErrorCode = (typeof PLAN_GRANTS_READ_ERROR_CODES)[number];

export const planGrantsReadErrorSchema = z.object({ error: z.enum(PLAN_GRANTS_READ_ERROR_CODES) });
export type PlanGrantsReadError = z.infer<typeof planGrantsReadErrorSchema>;
