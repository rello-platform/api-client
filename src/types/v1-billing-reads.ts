/**
 * PFP Gateway P-1: Rello's tenant-bound v1 billing reads (SPEC-PFP-GATEWAY.md
 * §4.2 "Read-through on unknown"; Platform KA prompt 1221, rulings 1220/1247).
 * One contract for Rello's routes and PathfinderPro's callers.
 *
 *   GET  /api/v1/billing/plan-grants   permission billing:plan-grants:read
 *   GET  /api/v1/billing/add-ons       permission billing:read
 *   POST /api/v1/billing/add-on        permission billing:write  (the start; R1)
 *
 * Auth: `Authorization: Bearer <ApiKey>` (Rello's ApiKey table, targetApp RELLO)
 * with the route's permission, then §4.2's tenant match (Rello's
 * `requireV1TenantMatch`). The tenant is the key's own, or `X-Tenant-Id` for a
 * tenant-null key; never a body. The two reads answer flat JSON (no
 * `{ success, data }` envelope); the POST start keeps R1's envelope.
 */
import { z } from "zod";
import { tenantCyrStateSchema } from "./provisioning.js";
import { planTrialStateSchema } from "./plan-trial.js";

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
  /** v2.43.0 (G-10R-2t-A): the Full PFP plan trial. null = none; ABSENT = an older Rello (unknown); never defaulted to null. */
  trial: planTrialStateSchema.nullable().optional(),
  /** v2.45.0 (UPGRADE-TO-RELLO, ./plan-class.ts): "rello" | "app" today; a plain string, compare with isPlanClass(). ABSENT = an older Rello. */
  planClass: z.string().min(1).optional(),
});
export type PlanGrantsReadResponse = z.infer<typeof planGrantsReadResponseSchema>;

/**
 * The read's own refusals, besides the tenant 403s and requireV1Auth's 401/403:
 *  - 404 `no_plan_grants`: the read succeeded and the tenant has no grant state.
 *    For a gateway-origin tenant that is a contract violation (Rello writes the
 *    marker and the state together); the caller still treats it as unknown.
 *  - 503 `plan_grants_unavailable`: Rello could not read the state, or holds a
 *    row it cannot serve. Unknown: retry, never "no grants".
 *
 * `cyr.canceledAt` is always null on this read, CANCELED included (KA ruling
 * 1261): Rello stores no canceledAt for the record, so a CANCELED record comes
 * with `canceledAt: null` and `occurredAt` = the record's last change. Use
 * `occurredAt` as the cancel time; it can only be later than the true one.
 */
export const PLAN_GRANTS_READ_ERROR_CODES = ["no_plan_grants", "plan_grants_unavailable"] as const;
export type PlanGrantsReadErrorCode = (typeof PLAN_GRANTS_READ_ERROR_CODES)[number];

export const planGrantsReadErrorSchema = z.object({ error: z.enum(PLAN_GRANTS_READ_ERROR_CODES) });
export type PlanGrantsReadError = z.infer<typeof planGrantsReadErrorSchema>;

// ─── GET /api/v1/billing/add-ons ────────────────────────────────────────────

/**
 * What Rello would charge this tenant for ONE unit of the add-on, per interval,
 * in integer cents: the price the POST start charges, read from the catalog row
 * that holds it. No Stripe call.
 *
 * `null` means UNKNOWN, never $0: Rello holds no Stripe price for that interval
 * (a POST would refuse `addon_price_not_configured`) or the amount can't be
 * read. A determined `0` is a real $0. A ONE_TIME add-on has no per-interval
 * price, so both are null and `type` says why.
 */
export const addOnUnitPriceSchema = z.object({
  monthly: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  yearly: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
});
export type AddOnUnitPrice = z.infer<typeof addOnUnitPriceSchema>;

/**
 * A ONE_TIME add-on's price (PFP Gateway G-LR Part B, Platform KA prompt 1323):
 * `once` is integer cents for one purchase, the price Kelly sets on the add-on
 * in Platform Admin (Rello's "once" catalog slot). `null` means no one-time
 * price is set (unknown, never $0); the key is always present on a ONE_TIME
 * item. A ONE_TIME add-on has no per-interval price, so `monthly` and `yearly`
 * are always null. A RECURRING add-on's price stays `addOnUnitPriceSchema`,
 * with no `once` key.
 */
export const addOnOneTimePriceSchema = z.object({
  monthly: z.null(),
  yearly: z.null(),
  once: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
});
export type AddOnOneTimePrice = z.infer<typeof addOnOneTimePriceSchema>;

/** Rello's SubscriptionStatus values today. `status` parses as a plain string so a later status never fails the read. */
export const TENANT_ADD_ON_STATUSES = ["ACTIVE", "TRIALING", "PAST_DUE", "CANCELED", "INCOMPLETE"] as const;

/**
 * This tenant's subscription to the add-on (Rello's TenantAddOn), or null when
 * there is none. `quantityRev` is a BIGINT, sent as a decimal string so it is
 * exact past Number.MAX_SAFE_INTEGER; compare it with BigInt(), never Number().
 */
export const v1AddOnTenantSubscriptionSchema = z.object({
  status: z.string().min(1),
  quantity: z.number().int().nonnegative(),
  requestedQuantity: z.number().int().nonnegative().nullable(),
  quantityRev: z.string().regex(/^\d{1,19}$/).nullable(),
  trialEndsAt: z.string().datetime({ offset: true }).nullable(),
});
export type V1AddOnTenantSubscription = z.infer<typeof v1AddOnTenantSubscriptionSchema>;

const v1AddOnReadFields = {
  id: z.string().min(1),
  appSlug: z.string().min(1),
  name: z.string().min(1),
  isActive: z.boolean(),
  tenantAddOn: v1AddOnTenantSubscriptionSchema.nullable(),
};

/**
 * One add-on the caller's app owns, active or not (`isActive` false = retired
 * from sale; existing subscribers keep it). Discriminated on `type`: a
 * RECURRING item's price is `{ monthly, yearly }` (unchanged); a ONE_TIME
 * item's price also carries `once` (G-LR Part B).
 */
export const v1AddOnReadSchema = z.discriminatedUnion("type", [
  z.object({ ...v1AddOnReadFields, type: z.literal("RECURRING"), price: addOnUnitPriceSchema }),
  z.object({ ...v1AddOnReadFields, type: z.literal("ONE_TIME"), price: addOnOneTimePriceSchema }),
]);
export type V1AddOnRead = z.infer<typeof v1AddOnReadSchema>;

/**
 * 200. Only the calling app's add-ons, ordered by name then id. Never another
 * app's add-on and never another tenant's subscription.
 *
 * Before PathfinderPro can call this, `billing:read` must be granted to
 * pathfinder-pro and carried on its RELLO-targeted ApiKey.
 */
export const v1AddOnsReadResponseSchema = z.object({ addOns: z.array(v1AddOnReadSchema) });
export type V1AddOnsReadResponse = z.infer<typeof v1AddOnsReadResponseSchema>;

/** 503 `add_ons_unavailable`: a read failed. Unknown: retry, never "no add-ons". */
export const ADD_ONS_READ_ERROR_CODES = ["add_ons_unavailable"] as const;
export type AddOnsReadErrorCode = (typeof ADD_ONS_READ_ERROR_CODES)[number];
export const addOnsReadErrorSchema = z.object({ error: z.enum(ADD_ONS_READ_ERROR_CODES) });
export type AddOnsReadError = z.infer<typeof addOnsReadErrorSchema>;

// ─── POST /api/v1/billing/add-on (the start, R1) ────────────────────────────

/** The idempotency header the POST requires: 8–128 characters, one per intended start. */
export const ADD_ON_START_IDEMPOTENCY_HEADER = "X-Idempotency-Key";

/**
 * The body, strict: an unknown field (a coupon, a tenant) is a 400.
 * `quantity` defaults to 1 on Rello. `trial` (Check Your Rate only) asks for the
 * one 14-day no-card trial. `quantityRev` (Check Your Rate) is PFP's monotonic
 * revision of the page count: an integer, or a decimal string of 1–18 digits.
 */
export const addOnStartRequestSchema = z
  .object({
    addOnId: z.string().min(1),
    quantity: z.number().int().positive().optional(),
    trial: z.boolean().optional(),
    quantityRev: z.union([z.number().int().nonnegative(), z.string().regex(/^\d{1,18}$/)]).optional(),
  })
  .strict();
export type AddOnStartRequest = z.infer<typeof addOnStartRequestSchema>;

/**
 * 200, R1's envelope. A same-key retry answers the first result again.
 * `trialEndsAt` is present for Check Your Rate (null when not trialing) and
 * absent for any other add-on.
 */
export const addOnStartResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    tenantAddOnId: z.string().min(1),
    status: z.string().min(1),
    trialEndsAt: z.string().datetime({ offset: true }).nullable().optional(),
  }),
});
export type AddOnStartResponse = z.infer<typeof addOnStartResponseSchema>;

/**
 * A refusal from the route itself: `{ success: false, error, code? }` plus the
 * fields a code carries (`needsPaymentMethod`, `coveredSeats`, ...), kept by
 * `.loose()`. `code` is a plain string so a later code never fails the parse.
 * requireV1Auth's own 401/403 are `{ error }` alone (v1TenantMatchErrorSchema).
 */
export const addOnStartErrorSchema = z
  .object({
    success: z.literal(false),
    error: z.string().min(1),
    code: z.string().min(1).optional(),
  })
  .loose();
export type AddOnStartError = z.infer<typeof addOnStartErrorSchema>;

/**
 * The codes R1's Check Your Rate start answers today, for callers that branch on them.
 * `addon_price_not_configured` (409) carries `family`, `interval` and `addOnId`, kept by
 * `.loose()`. The older spelling `addon_pricing_not_configured` is not listed: nothing in
 * Rello main sends it (AUDIT 111 GD-2250); `code` stays an open string, so a body that
 * carries it still parses.
 */
export const ADD_ON_START_ERROR_CODES = [
  "not_a_check_your_rate_addon",
  "payment_method_required",
  "tenant_not_found",
  "addon_already_active",
  "addon_state_unknown",
  "already_entitled",
  "engine_required",
  "trial_already_used",
  "addon_price_not_configured",
  "stripe_failed",
] as const;
export type AddOnStartErrorCode = (typeof ADD_ON_START_ERROR_CODES)[number];
