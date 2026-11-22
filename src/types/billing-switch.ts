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

/**
 * Add-ons a Pro/Team -> Starter/Rates switch can keep instead of dropping (K1, v2.42.0).
 * Today only Refi Radar. Absent = drop, exactly as before.
 */
export const PLAN_SWITCH_KEEP_ADDONS = ["refi-radar"] as const;
export type PlanSwitchKeepAddOn = (typeof PLAN_SWITCH_KEEP_ADDONS)[number];

const keepAddOnField = z.enum(PLAN_SWITCH_KEEP_ADDONS);

/**
 * v2.48.0 (D65 step 3, Platform KA prompt 1694): the optional launch discount code on the preview and the POST. A
 * human-typed code (never a Stripe id), at most {@link PLAN_SWITCH_PROMOTION_CODE_MAX_LENGTH} characters, trimmed;
 * empty or blank is the same as absent (today's behaviour, byte for byte). Rello asks Stripe about it; PFP never
 * computes a discounted price.
 */
export const PLAN_SWITCH_PROMOTION_CODE_MAX_LENGTH = 200;
const promotionCodeField = z.preprocess(
  (raw: unknown) => (typeof raw === "string" ? (raw.trim().length === 0 ? undefined : raw.trim()) : raw),
  z.string().min(1).max(PLAN_SWITCH_PROMOTION_CODE_MAX_LENGTH).optional(),
);

// ─── Preview ────────────────────────────────────────────────────────────────

/**
 * Query of `GET /api/v1/billing/plan-switch/preview`. `interval` absent = the current one.
 * `keepAddOns` (v2.42.0): `refi-radar` to keep Refi Radar through the switch; the param may be
 * repeated in the URL and each value is checked against {@link PLAN_SWITCH_KEEP_ADDONS}; absent = drop.
 */
export const planSwitchPreviewQuerySchema = z
  .object({
    targetPlanSlug: z.string().trim().min(1),
    interval: intervalField.optional(),
    keepAddOns: keepAddOnField.optional(),
    /** v2.48.0: the discount code to quote with. The POST must send the same code with this preview's id. */
    promotionCode: promotionCodeField,
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
  /** `refiRadarKept` (v2.42.0) is present only when the server answers the keep-add-ons question; absent is not `false`. */
  chargeChange: { carriedCheckYourRateSeat: boolean; refiRadarDrops: boolean; refiRadarKept?: boolean };
  /**
   * v2.45.0 (UPGRADE-TO-RELLO §D3/§D6): the apps the tenant keeps, gains and loses through this switch, by app
   * slug. ABSENT = an older Rello that does not say (unknown), never "no change".
   */
  apps?: PlanSwitchApps;
  /** v2.45.0: what is charged now, in the currency's minor unit (the sum of `subscriptions[].total`; negative = a credit). Absent = an older Rello. */
  amountDueNow?: number;
  /**
   * v2.48.0 (D65 step 3): present only when the preview was asked with a `promotionCode` Stripe accepted.
   * `subscriptions[].total` and `amountDueNow` are already Stripe's discounted totals.
   */
  promotion?: PlanSwitchPreviewPromotion;
}

/** v2.48.0: a coupon's terms, exactly as Stripe states them (for the screen to say, e.g., "$5 off for 3 months"). */
export interface PlanSwitchPromotionCouponTerms {
  name: string | null;
  /** e.g. 20 for 20%; null for an amount-off coupon. */
  percentOff: number | null;
  /** Minor units; null for a percent-off coupon. */
  amountOff: number | null;
  currency: string | null;
  duration: "once" | "repeating" | "forever";
  durationInMonths: number | null;
}

/** v2.48.0: the preview's discount code, as Stripe resolved and priced it. */
export interface PlanSwitchPreviewPromotion {
  /** Stripe's spelling of the code. */
  code: string;
  /** What Stripe's preview says the code takes off the amount due now, in the currency's minor unit. */
  discountAmount: number;
  coupon: PlanSwitchPromotionCouponTerms;
}

/** v2.45.0: a plan switch's effect on the tenant's apps, by app slug (Rello's D1 rule, from local rows). */
export interface PlanSwitchApps {
  kept: string[];
  added: string[];
  dropped: string[];
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
    /** v2.42.0 (K1): keep Refi Radar through a Pro/Team -> Starter/Rates switch. Absent = drop. */
    keepAddOns: z.array(keepAddOnField).max(1).optional(),
    /** v2.48.0: the code the preview named by `previewId` was quoted with. Needs `previewId`. */
    promotionCode: promotionCodeField,
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
  /** v2.42.0 (K1): at most one entry, today `["refi-radar"]`. Absent = drop. */
  keepAddOns?: PlanSwitchKeepAddOn[];
  /** v2.48.0 (D65 step 3): the code the preview was asked with; send it with that preview's `previewId`. */
  promotionCode?: string;
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
  /**
   * v2.45.0 (UPGRADE-TO-RELLO §D7): where to send the person when the target is a Rello plan
   * (`<Rello origin>/welcome/rello?op=<operationId>`); `null` for any other target. ABSENT = an older Rello.
   */
  relloUrl?: string | null;
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
  /** v2.45.0 (§D7): as on {@link PlanSwitchAppliedResponse}, set once the operation is APPLIED to a Rello plan; else null. ABSENT = an older Rello. */
  relloUrl?: string | null;
}

// ─── Plan-switch errors ─────────────────────────────────────────────────────

/**
 * Every `error` the plan-switch routes answer. Each one is a billing action
 * refused, never a send gate.
 *
 *  400 invalid_body · switch_not_allowed · contact_sales · addon_price_not_configured ·
 *      confirmation_required (a D47 downgrade without previewId + confirmedChargeChange === true) ·
 *      addon_not_offered (v2.42.0: keepAddOns names an add-on the tenant doesn't hold, or the target plan can't carry) ·
 *      no_plan_subscription (v2.45.0: no Stripe customer, or no live plan subscription; send the person to
 *      /pricing / Checkout instead)
 *  402 payment_failed (step 1 declined; nothing applied)
 *  404 operation_not_found
 *  409 idempotency_key_reused · members_exceed_target · billing_mode_classic · already_on_plan ·
 *      preview_stale (expired / mismatched / another tenant's / its inputs changed) · preview_consumed ·
 *      stale_switch · switch_in_progress · use_plan_switch (the subscription PUT and the admin plan
 *      field for a gateway tenant)
 *  503 provider_unreadable (outcome unknown: poll the GET) · not_armed (the open rolled back:
 *      retry with the same idempotencyKey)
 *
 * v2.48.0 (D65 step 3), each a refusal of the discount CODE only — the same switch without a code is unaffected:
 *  400 code_not_found · code_expired · code_inactive · code_used_up · code_not_for_plan (the coupon is restricted
 *      to other products) · code_not_for_account (another customer's code) · code_not_applicable (Stripe refused it
 *      on this change, e.g. first purchase only; its words are in `message`) · promotion_code_requires_preview (a
 *      POST code with no previewId)
 *  409 preview_stale reason `promotion_code_changed`: the POST's code is not the code the preview was quoted with
 *  503 provider_unreadable: Stripe could not be read to check the code (never reported as code_not_found)
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
  "addon_not_offered",
  "no_plan_subscription",
  "code_not_found",
  "code_expired",
  "code_inactive",
  "code_used_up",
  "code_not_for_plan",
  "code_not_for_account",
  "code_not_applicable",
  "promotion_code_requires_preview",
] as const;
export type PlanSwitchErrorCode = (typeof PLAN_SWITCH_ERROR_CODES)[number];

/**
 * Why a preview is stale (GD-1778). Optional and additive: an absent reason is
 * the round-2 meaning (expired or mismatched).
 *  - inputs_changed: an add-on quantity, a new add-on row or a catalog price id changed
 *    since the preview. 0 operations and 0 Stripe calls of any kind.
 *  - provider_changed: Stripe's plan price, period end, an add-on item, or the
 *    add-on subscription's trial state differs from what the preview read. The shared reader's two reads, each ≤ 1 bounded retry; 0 mutations.
 *  - expired: past `expiresAt`.
 *  - promotion_code_changed (v2.48.0): the POST's `promotionCode` is not the code this preview was quoted with
 *    (a different one, none against a coded preview, or one against an uncoded preview).
 * What PFP does for any of them: fetch a fresh preview and confirm again.
 */
export const PREVIEW_STALE_REASONS = ["inputs_changed", "provider_changed", "expired", "promotion_code_changed"] as const;
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
  chargeChange: z.object({ carriedCheckYourRateSeat: z.boolean(), refiRadarDrops: z.boolean(), refiRadarKept: z.boolean().optional() }),
  /** v2.45.0: optional; absent stays absent. */
  apps: z
    .object({ kept: z.array(z.string().min(1)), added: z.array(z.string().min(1)), dropped: z.array(z.string().min(1)) })
    .optional(),
  /** v2.45.0: optional; absent stays absent. */
  amountDueNow: minorAmount.optional(),
  /** v2.48.0: optional; absent = no code was asked (or an older Rello). */
  promotion: z
    .object({
      code: z.string().min(1),
      discountAmount: minorAmount,
      coupon: z.object({
        name: z.string().nullable(),
        percentOff: z.number().nullable(),
        amountOff: minorAmount.nullable(),
        currency: z.string().nullable(),
        duration: z.enum(["once", "repeating", "forever"]),
        durationInMonths: z.number().int().nullable(),
      }),
    })
    .optional(),
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
  /** v2.45.0 (§D7): optional; absent stays absent. */
  relloUrl: z.string().min(1).nullable().optional(),
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
  /** v2.45.0 (§D7): optional; absent stays absent. */
  relloUrl: z.string().min(1).nullable().optional(),
}) satisfies z.ZodType<PlanSwitchOperationResponse>;

/** `409 switch_in_progress`: another switch for this tenant is running; poll it. */
export const switchInProgressErrorSchema = z.object({
  error: z.literal("switch_in_progress"),
  operationId: z.string().min(1),
});
export type SwitchInProgressError = z.infer<typeof switchInProgressErrorSchema>;

/**
 * The plan-switch codes that have their own exact schema. A body naming one of
 * these is that refusal or nothing: it never parses through the open branch
 * below (AUDIT 111 GD-2146, KA 1275).
 */
export const PLAN_SWITCH_DEDICATED_ERROR_CODES = ["members_exceed_target", "preview_stale", "switch_in_progress"] as const;
const DEDICATED_CODES: ReadonlySet<string> = new Set(PLAN_SWITCH_DEDICATED_ERROR_CODES);

/**
 * Any OTHER plan-switch refusal: `{ error: <code>, message? }`, for every code
 * that has no dedicated schema. `error` is a plain string on the wire (like
 * preview_stale's `reason`), so a code Rello adds later is still an answer;
 * compare it against {@link PLAN_SWITCH_ERROR_CODES}. Extra fields are kept.
 * A code in {@link PLAN_SWITCH_DEDICATED_ERROR_CODES} is refused here: it must
 * pass its own schema.
 */
export const planSwitchOtherErrorSchema = z
  .object({
    error: z
      .string()
      .min(1)
      .refine((code) => !DEDICATED_CODES.has(code), { message: "this code has its own schema" }),
    message: z.string().optional(),
  })
  .loose();
export type PlanSwitchOtherError = z.infer<typeof planSwitchOtherErrorSchema>;

/**
 * Every plan-switch refusal. A body naming `members_exceed_target`,
 * `preview_stale` or `switch_in_progress` parses only through that code's own
 * schema, so a malformed one (missing or negative counts, a non-string reason,
 * no operationId) is refused, never accepted through the open branch. Any other
 * code, a future one included, parses through the open branch.
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
