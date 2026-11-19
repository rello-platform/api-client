/**
 * PFP Gateway "Match my design" (Platform KA prompt 1419; Kelly D55: a $99
 * one-time charge per request): charge ONE one-time add-on to the tenant's
 * saved card when PathfinderPro asks. One contract for Rello's route and
 * PathfinderPro's caller.
 *
 *   POST /api/v1/billing/add-on/charge-once                  permission billing:addon-charge:write
 *   GET  /api/v1/billing/add-on/charge-once?requestId=<id>   permission billing:addon-charge:write
 *
 * (`billing:addon-charge:write`: @rello-platform/permissions v0.66.0.)
 *
 * Auth: `Authorization: Bearer <ApiKey>` (Rello's ApiKey table, targetApp RELLO),
 * then the add-on must belong to the calling app (callerOwnsAddOn). The tenant is
 * the key's own, or `X-Tenant-Id` for a tenant-null key; never a body.
 *
 * ONE CHARGE PER REQUEST ID. The request id is the idempotency key: the same id is
 * the same charge, replayed with the same answer; a new id is a new charge.
 *
 * THE AMOUNT IS NEVER THE CALLER'S. Rello charges the add-on's catalog price. The
 * caller sends `quoteCents`, the price it showed the person (the `price.once` it
 * read from GET /api/v1/billing/add-ons); a catalog price that is not that is a 409
 * `price_changed` and nothing is charged.
 *
 * ANSWERS (discriminated on `status`):
 *   200 charged   { chargeId, amountCents, paidAt }  the money was taken (also the replay of it)
 *   402 declined  { message }                        the card refused; nothing was taken
 *   202 unknown   { chargeId }                       Rello does not yet know. NEVER charge again:
 *                                                    GET by requestId until it settles
 *   200 manual    { reason }                         nothing was charged: the tenant has no Stripe
 *                                                    customer or no saved card. Tell the owner; they
 *                                                    settle it by hand
 * Refusals are `{ error }`: 409 price_changed | add_on_not_one_time, 404 add_on_not_found; the
 * 400/401/403 keep the client's existing shapes. A GET for a request id with no claim on the
 * caller's tenant is 404 (its body is `{ error: string }`).
 *
 * A network failure, a timeout or a 5xx after the POST left the process is NOT "declined" and NOT
 * "not charged": Rello may have taken the money. Treat it as unknown and GET by the same request id.
 */
import { z } from "zod";

/** The idempotency header the POST requires (Rello's v1 billing mutations all use this name): 8–128 characters, one per intended charge. */
export const ADD_ON_CHARGE_ONCE_IDEMPOTENCY_HEADER = "X-Idempotency-Key";

/**
 * The same value under the unprefixed name. The client method sends both so a route that reads either
 * name sees the key. Rello's shared reader (readIdempotencyKey) reads X-Idempotency-Key.
 */
export const ADD_ON_CHARGE_ONCE_IDEMPOTENCY_HEADER_ALIAS = "Idempotency-Key";

/** The spoke's request id, which is the idempotency key. Trimmed, 8–128 characters. */
export const addOnChargeOnceRequestIdSchema = z.string().trim().min(8).max(128);

/** The POST body, strict: an amount, a tenant or a coupon from the caller is a 400. */
export const addOnChargeOnceRequestSchema = z
  .object({
    addOnId: z.string().min(1),
    /** The one-time price the caller showed, integer cents (>= 0). Never charged; only compared. */
    quoteCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type AddOnChargeOnceRequest = z.infer<typeof addOnChargeOnceRequestSchema>;

/** The GET query, strict. */
export const addOnChargeOnceQuerySchema = z.object({ requestId: addOnChargeOnceRequestIdSchema }).strict();
export type AddOnChargeOnceQuery = z.infer<typeof addOnChargeOnceQuerySchema>;

const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** 200: the money was taken. `amountCents` is what Rello charged (integer cents). */
export const addOnChargeOnceChargedSchema = z.object({
  status: z.literal("charged"),
  chargeId: z.string().min(1),
  amountCents: cents,
  paidAt: z.string().datetime({ offset: true }),
});

/** 402: the card refused. Nothing was taken. */
export const addOnChargeOnceDeclinedSchema = z.object({
  status: z.literal("declined"),
  message: z.string(),
});

/** 202: unknown. Never charge again; read the state by request id. */
export const addOnChargeOnceUnknownSchema = z.object({
  status: z.literal("unknown"),
  chargeId: z.string().min(1),
});

/** Why nothing was charged. */
export const ADD_ON_CHARGE_ONCE_MANUAL_REASONS = ["no_stripe_customer", "no_payment_method"] as const;
export type AddOnChargeOnceManualReason = (typeof ADD_ON_CHARGE_ONCE_MANUAL_REASONS)[number];

/** 200: nothing was charged; the owner settles it by hand. */
export const addOnChargeOnceManualSchema = z.object({
  status: z.literal("manual"),
  reason: z.enum(ADD_ON_CHARGE_ONCE_MANUAL_REASONS),
});

/** Every answer of the POST and the GET, discriminated on `status`. */
export const addOnChargeOnceAnswerSchema = z.discriminatedUnion("status", [
  addOnChargeOnceChargedSchema,
  addOnChargeOnceDeclinedSchema,
  addOnChargeOnceUnknownSchema,
  addOnChargeOnceManualSchema,
]);
export type AddOnChargeOnceAnswer = z.infer<typeof addOnChargeOnceAnswerSchema>;
export type AddOnChargeOnceCharged = z.infer<typeof addOnChargeOnceChargedSchema>;
export type AddOnChargeOnceDeclined = z.infer<typeof addOnChargeOnceDeclinedSchema>;
export type AddOnChargeOnceUnknown = z.infer<typeof addOnChargeOnceUnknownSchema>;
export type AddOnChargeOnceManual = z.infer<typeof addOnChargeOnceManualSchema>;

/** The refusals the route names today: 409 price_changed | add_on_not_one_time, 404 add_on_not_found. */
export const ADD_ON_CHARGE_ONCE_ERROR_CODES = ["price_changed", "add_on_not_one_time", "add_on_not_found"] as const;
export type AddOnChargeOnceErrorCode = (typeof ADD_ON_CHARGE_ONCE_ERROR_CODES)[number];

/**
 * A refusal body `{ error }`. `error` is a plain string and `.loose()` keeps any extra field, so a
 * later code never fails the parse; compare it with ADD_ON_CHARGE_ONCE_ERROR_CODES.
 */
export const addOnChargeOnceErrorSchema = z.object({ error: z.string().min(1) }).loose();
export type AddOnChargeOnceError = z.infer<typeof addOnChargeOnceErrorSchema>;
