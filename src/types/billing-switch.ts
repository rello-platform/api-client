/**
 * PFP Gateway G-10R + G-EXTRAS (PKG-2): the plan-switch and add-on quantity
 * contract between Rello's v1 billing routes and PathfinderPro's callers.
 * Spec SPEC-PFP-GATEWAY.md G-10R (D47, K-248, H-172); plan a7-1147 §F/§P;
 * Platform KA prompt 1199. One contract, imported by both sides.
 *
 * Auth on every route: `Authorization: Bearer <ApiKey>` (Rello's ApiKey table,
 * targetApp RELLO) plus §4.2's tenant match. The tenant, the Stripe customer,
 * subscriptions and items are never taken from a body or query.
 *
 *   GET   /api/v1/billing/plan-switch/preview?targetPlanSlug=&interval=   (G-10R-2)
 *   POST  /api/v1/billing/plan-switch                                     (G-10R-2)
 *   GET   /api/v1/billing/plan-switch/[operationId]                       (G-10R-2)
 *   PATCH /api/v1/billing/add-on/[addOnId]  + `X-Idempotency-Key` header  (R1, generalized by X1)
 */
import { z } from "zod";

export const PLAN_SWITCH_INTERVALS = ["month", "year"] as const;
export type PlanSwitchInterval = (typeof PLAN_SWITCH_INTERVALS)[number];

const intervalField = z.enum(PLAN_SWITCH_INTERVALS);

// ─── Preview ────────────────────────────────────────────────────────────────

/** Query of `GET /api/v1/billing/plan-switch/preview`. `interval` absent = the current one. */
export const planSwitchPreviewQuerySchema = z
  .object({
    targetPlanSlug: z.string().trim().min(1),
    interval: intervalField.optional(),
  })
  .strict();
export type PlanSwitchPreviewQuery = z.infer<typeof planSwitchPreviewQuerySchema>;

/** One line of Stripe's own preview invoice for one subscription. Amounts in the currency's minor unit. */
export interface PlanSwitchPreviewLine {
  description: string;
  amount: number;
  currency: string;
  /** ISO timestamps. */
  period: { start: string; end: string };
  proration: boolean;
}

/** Each subscription that will change gets its own preview; one invoice never covers both. */
export interface PlanSwitchPreviewSubscription {
  kind: "plan" | "addon";
  lines: PlanSwitchPreviewLine[];
  total: number;
}

/**
 * 200 of the preview. Rello stores the preview (with the inputs it was computed
 * from) and issues `previewId`; a confirmed POST names it, so the numbers the
 * MLO confirmed are the numbers charged. Valid until `expiresAt`
 * (= min(prorationDate + 15 min, the plan period end)).
 */
export interface PlanSwitchPreviewResponse {
  previewId: string;
  /** ISO. */
  expiresAt: string;
  /** ISO. The proration instant both steps use when the POST names this preview. */
  prorationDate: string;
  /** true for Pro/Team → Starter/Rates (D47): the POST must carry this previewId and `confirmedChargeChange: true`. */
  requiresConfirmation: boolean;
  subscriptions: PlanSwitchPreviewSubscription[];
  planChange: { from: string; to: string; fromInterval: PlanSwitchInterval; toInterval: PlanSwitchInterval };
  chargeChange: { carriedCheckYourRateSeat: boolean; refiRadarDrops: boolean };
}

// ─── POST ───────────────────────────────────────────────────────────────────

/**
 * Body of `POST /api/v1/billing/plan-switch`, as Rello parses it (strict: no
 * tenant, no D47 options; those are fixed server-side).
 *
 * `confirmedChargeChange` is deliberately `unknown` here: a non-boolean must
 * reach switchPlan()'s `=== true` check and get `confirmation_required`, never a
 * generic `invalid_body`, and nothing can default it. Callers build the body as
 * {@link PlanSwitchRequest}.
 */
export const planSwitchRequestSchema = z
  .object({
    targetPlanSlug: z.string().min(1),
    /** Absent = the current interval. */
    interval: intervalField.optional(),
    idempotencyKey: z.string().min(8).max(200),
    previewId: z.string().min(1).optional(),
    confirmedChargeChange: z.unknown().optional(),
  })
  .strict();
export type PlanSwitchRequestParsed = z.infer<typeof planSwitchRequestSchema>;

/** What PFP sends. A downgrade (D47) carries the preview's `previewId` and `confirmedChargeChange: true`, from the one confirmation screen. */
export interface PlanSwitchRequest {
  targetPlanSlug: string;
  interval?: PlanSwitchInterval;
  idempotencyKey: string;
  previewId?: string;
  confirmedChargeChange?: true;
}

export type PlanSwitchOperationStatus = "OPEN" | "APPLIED" | "FAILED" | "COMPENSATED";
export type PlanSwitchStepState = "PENDING" | "IN_FLIGHT" | "DONE";

export interface PlanSwitchStep {
  index: number;
  kind: string;
  state: PlanSwitchStepState;
}

/** 200: the switch finished inside the request. */
export interface PlanSwitchAppliedResponse {
  operationId: string;
  status: "APPLIED";
  steps: PlanSwitchStep[];
  planSlug: string;
  interval: PlanSwitchInterval;
  invoiceIds: string[];
}

/** 202: still running; poll `GET /api/v1/billing/plan-switch/[operationId]`. */
export interface PlanSwitchOpenResponse {
  operationId: string;
  status: "OPEN";
}

export type PlanSwitchResponse = PlanSwitchAppliedResponse | PlanSwitchOpenResponse;

/** `GET /api/v1/billing/plan-switch/[operationId]`. Another tenant's id answers 404 `operation_not_found`. */
export interface PlanSwitchOperationResponse {
  operationId: string;
  status: PlanSwitchOperationStatus;
  steps: PlanSwitchStep[];
  previewId: string | null;
  invoiceIds: string[];
  resolutionNeeded: boolean;
  /** ISO, while the provider outcome is unknown; else null. */
  unknownSince: string | null;
}

// ─── Plan-switch errors ─────────────────────────────────────────────────────

/**
 * Every `error` the plan-switch routes answer. Each one is a billing action
 * refused, never a send gate.
 *
 *  400 invalid_body · switch_not_allowed · contact_sales · addon_price_not_configured ·
 *      confirmation_required (a D47 downgrade without previewId + confirmedChargeChange === true)
 *  402 payment_failed (step 1 declined; nothing applied)
 *  404 operation_not_found
 *  409 idempotency_key_reused · members_exceed_target · billing_mode_classic · already_on_plan ·
 *      preview_stale (expired / mismatched / another tenant's / its inputs changed) · preview_consumed ·
 *      stale_switch · switch_in_progress · use_plan_switch (the subscription PUT and the admin plan
 *      field for a gateway tenant)
 *  503 provider_unreadable (outcome unknown: poll the GET) · not_armed (the open rolled back:
 *      retry with the same idempotencyKey)
 */
export const PLAN_SWITCH_ERROR_CODES = [
  "invalid_body",
  "idempotency_key_reused",
  "switch_not_allowed",
  "contact_sales",
  "members_exceed_target",
  "addon_price_not_configured",
  "billing_mode_classic",
  "already_on_plan",
  "confirmation_required",
  "preview_stale",
  "preview_consumed",
  "stale_switch",
  "switch_in_progress",
  "payment_failed",
  "provider_unreadable",
  "not_armed",
  "use_plan_switch",
  "operation_not_found",
] as const;
export type PlanSwitchErrorCode = (typeof PLAN_SWITCH_ERROR_CODES)[number];

/**
 * Why a preview is stale (GD-1778). Optional and additive: an absent reason is
 * the round-2 meaning (expired or mismatched).
 *  - inputs_changed: an add-on quantity, a new add-on row or a catalog price id changed
 *    since the preview. 0 operations and 0 Stripe calls of any kind.
 *  - provider_changed: Stripe's plan price, period end, an add-on item, or the
 *    add-on subscription's trial state differs from what the preview read. One GET, 0 mutations.
 *  - expired: past `expiresAt`.
 * What PFP does for any of them: fetch a fresh preview and confirm again.
 */
export const PREVIEW_STALE_REASONS = ["inputs_changed", "provider_changed", "expired"] as const;
export type PreviewStaleReason = (typeof PREVIEW_STALE_REASONS)[number];

/**
 * `409 preview_stale`. `reason` is a plain string on the wire (like `cause`), so
 * a reason Rello adds later never makes an older PFP refuse the answer; compare
 * it against {@link PREVIEW_STALE_REASONS}.
 */
export const previewStaleErrorSchema = z.object({
  error: z.literal("preview_stale"),
  reason: z.string().optional(),
});
export type PreviewStaleError = z.infer<typeof previewStaleErrorSchema>;

/**
 * `409 members_exceed_target` (KA 1229 ruling for PFP K-345/O-10, 2026-11-17):
 * the target plan allows fewer logins than the account has active, so the
 * switch is refused with nothing changed. The counts follow the X1 quantity
 * PATCH's `members_exceed_quantity` (`{ activeMembers, quantity }`, Rello
 * src/lib/billing/addon-quantity.ts:297 @be87ded94): `activeMembers` the
 * active logins now, `targetLimit` what the target plan allows. Exact: no other
 * field, so a count can never arrive under another name.
 */
export const membersExceedTargetErrorSchema = z
  .object({
    error: z.literal("members_exceed_target"),
    activeMembers: z.number().int().nonnegative(),
    targetLimit: z.number().int().nonnegative(),
    /** For a person, as on every other plan-switch refusal. */
    message: z.string().optional(),
  })
  .strict();
export type MembersExceedTargetError = z.infer<typeof membersExceedTargetErrorSchema>;

export type PlanSwitchError =
  | PreviewStaleError
  | { error: "switch_in_progress"; operationId: string }
  | MembersExceedTargetError
  | { error: Exclude<PlanSwitchErrorCode, "preview_stale" | "switch_in_progress" | "members_exceed_target">; message?: string };

// ─── Plan-switch answer schemas (v2.37.0, PFP O-6) ──────────────────────────
//
// v2.36.0 shipped the answers above as types only. These parse them at
// runtime and are checked against the interfaces with `satisfies`. No Rello
// route serves plan-switch yet (G-10R builds it to this contract), so the
// tests' fixtures are hand-written from the contract and say so.
// Not strict: a field Rello adds later is dropped, never a refusal.

const isoInstant = z.string().min(1);
const minorAmount = z.number().int();

export const planSwitchPreviewLineSchema = z.object({
  description: z.string(),
  amount: minorAmount,
  currency: z.string().min(1),
  period: z.object({ start: isoInstant, end: isoInstant }),
  proration: z.boolean(),
}) satisfies z.ZodType<PlanSwitchPreviewLine>;

export const planSwitchPreviewSubscriptionSchema = z.object({
  kind: z.enum(["plan", "addon"]),
  lines: z.array(planSwitchPreviewLineSchema),
  total: minorAmount,
}) satisfies z.ZodType<PlanSwitchPreviewSubscription>;

/** 200 of GET /api/v1/billing/plan-switch/preview. */
export const planSwitchPreviewResponseSchema = z.object({
  previewId: z.string().min(1),
  expiresAt: isoInstant,
  prorationDate: isoInstant,
  requiresConfirmation: z.boolean(),
  subscriptions: z.array(planSwitchPreviewSubscriptionSchema),
  planChange: z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    fromInterval: intervalField,
    toInterval: intervalField,
  }),
  chargeChange: z.object({ carriedCheckYourRateSeat: z.boolean(), refiRadarDrops: z.boolean() }),
}) satisfies z.ZodType<PlanSwitchPreviewResponse>;

export const planSwitchStepSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: z.string().min(1),
  state: z.enum(["PENDING", "IN_FLIGHT", "DONE"]),
}) satisfies z.ZodType<PlanSwitchStep>;

/** 200 of POST /api/v1/billing/plan-switch: finished inside the request. */
export const planSwitchAppliedResponseSchema = z.object({
  operationId: z.string().min(1),
  status: z.literal("APPLIED"),
  steps: z.array(planSwitchStepSchema),
  planSlug: z.string().min(1),
  interval: intervalField,
  invoiceIds: z.array(z.string()),
}) satisfies z.ZodType<PlanSwitchAppliedResponse>;

/** 202 of POST /api/v1/billing/plan-switch: still running; poll the operation. */
export const planSwitchOpenResponseSchema = z.object({
  operationId: z.string().min(1),
  status: z.literal("OPEN"),
}) satisfies z.ZodType<PlanSwitchOpenResponse>;

export const planSwitchResponseSchema = z.discriminatedUnion("status", [
  planSwitchAppliedResponseSchema,
  planSwitchOpenResponseSchema,
]) satisfies z.ZodType<PlanSwitchResponse>;

/** 200 of GET /api/v1/billing/plan-switch/[operationId]. */
export const planSwitchOperationResponseSchema = z.object({
  operationId: z.string().min(1),
  status: z.enum(["OPEN", "APPLIED", "FAILED", "COMPENSATED"]),
  steps: z.array(planSwitchStepSchema),
  previewId: z.string().min(1).nullable(),
  invoiceIds: z.array(z.string()),
  resolutionNeeded: z.boolean(),
  unknownSince: isoInstant.nullable(),
}) satisfies z.ZodType<PlanSwitchOperationResponse>;

/** `409 switch_in_progress`: another switch for this tenant is running; poll it. */
export const switchInProgressErrorSchema = z.object({
  error: z.literal("switch_in_progress"),
  operationId: z.string().min(1),
});
export type SwitchInProgressError = z.infer<typeof switchInProgressErrorSchema>;

/**
 * Any other plan-switch refusal: `{ error: <code>, message? }`. `error` is a
 * plain string on the wire (like preview_stale's `reason`), so a code Rello
 * adds later is still an answer; compare it against {@link PLAN_SWITCH_ERROR_CODES}.
 * Extra fields are kept.
 */
export const planSwitchOtherErrorSchema = z
  .object({ error: z.string().min(1), message: z.string().optional() })
  .loose();
export type PlanSwitchOtherError = z.infer<typeof planSwitchOtherErrorSchema>;

/**
 * Every plan-switch refusal. The exact branches are tried first, so a body
 * that names `members_exceed_target`, `preview_stale` or `switch_in_progress`
 * but breaks that branch's shape fails those branches; it can still match the
 * open branch, so use the guards below (or `error` + the exact schema) to act
 * on one.
 */
export const planSwitchErrorSchema = z.union([
  membersExceedTargetErrorSchema,
  previewStaleErrorSchema,
  switchInProgressErrorSchema,
  planSwitchOtherErrorSchema,
]);

export function isMembersExceedTargetError(e: unknown): e is MembersExceedTargetError {
  return membersExceedTargetErrorSchema.safeParse(e).success;
}

// ─── Add-on quantity (R1's PATCH, generalized by X1) ────────────────────────

/**
 * The idempotency key travels in this header, 8–128 characters (R1's
 * `src/lib/billing/v1/idempotency-header.ts`). A missing or malformed one is
 * refused before anything else (`IDEMPOTENCY_KEY_REQUIRED` / `_INVALID`).
 */
export const ADDON_QUANTITY_IDEMPOTENCY_HEADER = "X-Idempotency-Key" as const;
export const ADDON_QUANTITY_IDEMPOTENCY_KEY_LENGTH = Object.freeze({ min: 8, max: 128 } as const);

/**
 * Body of `PATCH /api/v1/billing/add-on/[addOnId]`. `quantity` is absolute
 * (0 removes the item); `quantityRev` is the caller's monotonic revision, a
 * non-negative number or, past 2^53, a digit string. The key travels in the
 * {@link ADDON_QUANTITY_IDEMPOTENCY_HEADER} header. Strict: the tenant comes from auth.
 */
export const addOnQuantityRequestSchema = z
  .object({
    quantity: z.number().int().nonnegative(),
    quantityRev: z.union([z.number().int().nonnegative(), z.string().regex(/^\d{1,18}$/)]),
  })
  .strict();
export type AddOnQuantityRequest = z.infer<typeof addOnQuantityRequestSchema>;

/**
 * 200 `{ success: true, data }`. R1 (#2361/#2381) sends the first five fields.
 * `status` and `subscriptionCanceled` are added by X1 (the generic PATCH); a
 * reader must treat them as absent on an R1 answer.
 */
export const addOnQuantityResponseSchema = z.object({
  tenantAddOnId: z.string(),
  /** The quantity this revision asked for. */
  quantity: z.number().int().nonnegative(),
  /** The revision, as a decimal string. */
  quantityRev: z.string(),
  /** What Stripe bills now. */
  billedQuantity: z.number().int().nonnegative(),
  /** A newer revision already superseded this one; Stripe converges on the newest. */
  superseded: z.boolean(),
  /** X1: the TenantAddOn status after the change (ACTIVE, TRIALING, PAST_DUE, CANCELED). Absent from R1. */
  status: z.string().optional(),
  /** X1: true when quantity 0 ended the add-on's own subscription. Absent from R1. */
  subscriptionCanceled: z.boolean().optional(),
});
export type AddOnQuantityResponse = z.infer<typeof addOnQuantityResponseSchema>;

/**
 * The domain `code`s the quantity PATCH answers. Each refuses a billing action;
 * none is a send gate.
 *
 *  409 members_exceed_quantity    pfp-extra-team-login below the active login members
 *                                  (`{ activeMembers, quantity }`); 0 Stripe calls (X1)
 *  409 extra_mlos_exceed_quantity pfp-extra-signature below the active loginless MLOs
 *                                  (`{ activeLoginless, quantity }`); 0 Stripe calls (X1)
 *  409 stale_quantity_rev · 400 contact_sales (above the add-on's maxQuantity) ·
 *  400 included_in_plan (Refi Radar on Pro/Team) · addon_price_not_configured
 *  R1's own: 404 addon_not_found · 409 addon_not_active · 409 addon_state_unknown ·
 *  409 quantity_not_supported · 402 payment_method_required · 502 stripe_failed
 */
export const ADDON_QUANTITY_ERROR_CODES = [
  "members_exceed_quantity",
  "extra_mlos_exceed_quantity",
  "stale_quantity_rev",
  "contact_sales",
  "included_in_plan",
  "addon_price_not_configured",
  "addon_not_found",
  "addon_not_active",
  "addon_state_unknown",
  "quantity_not_supported",
  "payment_method_required",
  "stripe_failed",
] as const;
export type AddOnQuantityErrorCode = (typeof ADDON_QUANTITY_ERROR_CODES)[number];

/** The idempotency refusals every v1 billing mutation shares (uppercase, as R1 sends them): 400, 400, 422. */
export const ADDON_QUANTITY_IDEMPOTENCY_ERROR_CODES = [
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_INVALID",
  "IDEMPOTENCY_KEY_CONFLICT",
] as const;
export type AddOnQuantityIdempotencyErrorCode = (typeof ADDON_QUANTITY_IDEMPOTENCY_ERROR_CODES)[number];

/** 409 extra_mlos_exceed_quantity, exactly. */
export const extraMlosExceedQuantityErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.literal("extra_mlos_exceed_quantity"),
  activeLoginless: z.number().int().nonnegative(),
  quantity: z.number().int().nonnegative(),
});
export type ExtraMlosExceedQuantityError = z.infer<typeof extraMlosExceedQuantityErrorSchema>;

/** 409 members_exceed_quantity, exactly. */
export const membersExceedQuantityErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.literal("members_exceed_quantity"),
  activeMembers: z.number().int().nonnegative(),
  quantity: z.number().int().nonnegative(),
});
export type MembersExceedQuantityError = z.infer<typeof membersExceedQuantityErrorSchema>;

/**
 * Any other refusal the route gives. Not every answer carries a `code` or even
 * `success`: R1's 400 invalid body, 404 add-on not found, 403 other app's
 * add-on, 500 and 503 send `{ success: false, error }`; requireV1Auth's 401/403
 * and the tenant-app guard send `{ error }`. A code is one of
 * {@link ADDON_QUANTITY_ERROR_CODES}, {@link ADDON_QUANTITY_IDEMPOTENCY_ERROR_CODES},
 * or one a later Rello adds; extra fields (e.g. `convergence`) are kept.
 */
export const addOnQuantityOtherErrorSchema = z
  .object({
    success: z.literal(false).optional(),
    /** Human-readable. */
    error: z.string(),
    code: z.string().optional(),
  })
  .loose();
export type AddOnQuantityOtherError = z.infer<typeof addOnQuantityOtherErrorSchema>;

/** Every refusal of the quantity PATCH. Narrow the exact domain branches with the guards below. */
export const addOnQuantityErrorSchema = z.union([
  extraMlosExceedQuantityErrorSchema,
  membersExceedQuantityErrorSchema,
  addOnQuantityOtherErrorSchema,
]);
export type AddOnQuantityError = ExtraMlosExceedQuantityError | MembersExceedQuantityError | AddOnQuantityOtherError;

export function isExtraMlosExceedQuantityError(e: unknown): e is ExtraMlosExceedQuantityError {
  return extraMlosExceedQuantityErrorSchema.safeParse(e).success;
}

export function isMembersExceedQuantityError(e: unknown): e is MembersExceedQuantityError {
  return membersExceedQuantityErrorSchema.safeParse(e).success;
}
