/**
 * PFP Gateway G-SETUP + G-A2P: the one-time setup charge and the texting (A2P
 * 10DLC) registration that PathfinderPro asks Rello for. One contract for Rello's
 * routes and PFP's callers and receivers.
 *
 * Source: plan a6-1143 §D (Platform KA prompts 1143 / 1160 / 1172), spec
 * SPEC-PFP-GATEWAY.md rev 10.31 §4.12d item 6, the Platform KA's 2044Z contract
 * pins (fee GET is contract; attach is decided server-side), H-173 (quoteVersion,
 * 409 fee_changed), GD-1763 (409 business_suspension_final) and GD-1761
 * (an ambiguous provider create has no wire status).
 *
 * ONE envelope per lane. The same envelope is the event `data`, every route
 * answer and the GET, ordered by `rev` (per tenant, agent and lane).
 *
 * Auth on every route: `Authorization: Bearer <ApiKey>` (Rello's ApiKey table,
 * targetApp RELLO, appSource pathfinder-pro), permission
 * `billing:setup-charge:write` (charge lane, incl. the fee GET) or
 * `sms:registration:write` (registration lane), from @rello-platform/permissions
 * v0.61.0+. The tenant is checked against the key; the fee GET takes it from
 * the key alone.
 *
 *   GET  /api/provisioning/setup-charge/fee?feeSlug=…   → oneTimeFeeQuote
 *   POST /api/provisioning/setup-charge                 → setupChargeEnvelope
 *   GET  /api/provisioning/setup-charge?tenantId&relloAgentId&feeSlug
 *   POST /api/provisioning/sms-registration             → smsRegistrationEnvelope
 *   POST /api/provisioning/sms-registration/otp         → smsRegistrationEnvelope
 *   GET  /api/provisioning/sms-registration?tenantId&relloAgentId
 *   events on Rello's billing outbox: billing.setup_charge_changed, sms.registration_changed
 *
 * Rello's admin bodies (fee create/patch, manual settle, suspension outcomes,
 * provider-create outcome) are Rello-internal and are NOT in this package.
 *
 * Module-level helpers carry an `smsSetup` prefix so tsup renames nothing else
 * in the bundle.
 */
import { z } from "zod";

const smsSetupId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const smsSetupSlug = z.string().min(1).max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const smsSetupTime = z.iso.datetime({ offset: true });
/** H-167: producer rev per (tenantId, relloAgentId, lane), +1 in the state write's transaction. Apply only a higher rev. */
const smsSetupRev = z.number().int().min(1);

// ═══ Charge lane ════════════════════════════════════════════════════════════

/**
 * H-173: the fee row's version. Rello's DB trigger bumps it on any change of the
 * amount, the currency or isActive. PFP echoes the version the MLO confirmed.
 */
export const quoteVersion = z.number().int().min(1);

/**
 * POST /api/provisioning/setup-charge body. Strict: an unknown key is
 * `400 { error: "invalid_field", field, message }`. There is NO amount: Rello
 * charges the fee row's amount, read server-side. `quoteVersion` is required
 * (missing → 400 field "quoteVersion").
 */
export const setupChargeRequest = z.strictObject({
  tenantId: smsSetupId,
  relloAgentId: smsSetupId,
  feeSlug: smsSetupSlug,
  quoteVersion,
});
export type SetupChargeRequest = z.infer<typeof setupChargeRequest>;

/**
 * `voided`: a MANUAL charge whose hand invoice was never paid (show "No charge
 * was made"). `refunded`: the fee came back (registration could not complete).
 */
export const setupChargeStatus = z.enum(["pending", "paid", "failed", "unknown", "manual", "refunded", "voided"]);
export type SetupChargeStatus = z.infer<typeof setupChargeStatus>;

/** The charge envelope: billing.setup_charge_changed `data`, every setup-charge answer body, and the GET. */
export const setupChargeEnvelope = z.strictObject({
  tenantId: smsSetupId,
  relloAgentId: smsSetupId,
  feeSlug: smsSetupSlug,
  status: setupChargeStatus,
  /** true only when a PAID row is asked again. */
  alreadyPaid: z.boolean().optional(),
  /** failed: Stripe's decline message (never card data); manual: the reason in words. */
  message: z.string().max(500).optional(),
  chargeId: z.string().nullable(),
  rev: smsSetupRev,
  /** Display only; order by `rev`. */
  occurredAt: smsSetupTime,
});
export type SetupChargeEnvelope = z.infer<typeof setupChargeEnvelope>;

/**
 * POST setup-charge answers:
 *   200 paid | paid + alreadyPaid | manual | refunded     202 pending | unknown     402 failed
 *   400 { error: "invalid_field", field, message }   401 { error }   403 { error }
 *   404 { error: "agent_not_found" } | feeNotFound
 *   409 { error: "registration_required" }  (rate-check fee with no registration for the agent)
 *   409 feeChangedConflict                  (H-173: stale quoteVersion or inactive fee; no charge, no Stripe call)
 *   409 chargeConflict                      (below)
 *   500 internalError
 * An existing charge's own answer (200 alreadyPaid / 202 / 409 refund_in_progress)
 * comes before fee_changed: a retried POST for money already taken is never fee_changed.
 *
 * chargeConflict codes:
 *   registration_rejected     the registration attempt is terminal and not live; re-submit details first
 *   refund_in_progress        the previous attempt's refund is still out
 *   business_suspended        the team's business is suspended at Twilio
 *   business_suspension_final GD-1763: closed by the carriers; no charge until Rello's operator records
 *                             the provider outcome
 * `envelope` is this MLO's charge envelope, or null when the MLO has no charge row.
 */
export const chargeConflict = z.strictObject({
  error: z.enum(["registration_rejected", "refund_in_progress", "business_suspended", "business_suspension_final"]),
  envelope: setupChargeEnvelope.nullable(),
});
export type ChargeConflict = z.infer<typeof chargeConflict>;

/**
 * GET /api/provisioning/setup-charge/fee?feeSlug=… query. The tenant comes from
 * the ApiKey row, never a parameter. Missing or malformed → 400 field "feeSlug".
 */
export const feeSlugQuery = z.strictObject({ feeSlug: smsSetupSlug });
export type FeeSlugQuery = z.infer<typeof feeSlugQuery>;

/**
 * 200 of the fee GET, and the `quote` of 409 fee_changed. `isActive: false` =
 * not offered now. The amount is the row's, never a default or a cached price
 * (an unreadable row is 500, never a quote).
 */
export const oneTimeFeeQuote = z.strictObject({
  feeSlug: smsSetupSlug,
  label: z.string().min(1).max(120),
  amountCents: z.number().int().positive(),
  currency: z.string().regex(/^[a-z]{3}$/),
  isActive: z.boolean(),
  quoteVersion,
});
export type OneTimeFeeQuote = z.infer<typeof oneTimeFeeQuote>;

/**
 * H-173: 409 on POST setup-charge when the body's quoteVersion is not the fee
 * row's, or the row is inactive. `quote` is the CURRENT row: PFP shows it for a
 * fresh confirmation and never retries on its own. Replaces `fee_inactive`.
 */
export const feeChangedConflict = z.strictObject({ error: z.literal("fee_changed"), quote: oneTimeFeeQuote });
export type FeeChangedConflict = z.infer<typeof feeChangedConflict>;

/** 404 of the fee GET and of POST setup-charge: no such fee row. */
export const feeNotFound = z.strictObject({ error: z.literal("fee_not_found") });
export type FeeNotFound = z.infer<typeof feeNotFound>;

/** 500 on every G-SETUP / G-A2P route: never internals. PFP shows "unknown", never "not paid". */
export const internalError = z.strictObject({ error: z.string().min(1), requestId: z.string().min(1) });
export type InternalError = z.infer<typeof internalError>;

// ═══ Registration lane ══════════════════════════════════════════════════════

const smsSetupE164Us = z.string().regex(/^\+1[2-9]\d{9}$/, "Use a US number like +18015550101");
const smsSetupEmail = z.email().max(254);
const smsSetupAddress = z.strictObject({
  street: z.string().min(1).max(100),
  street2: z.string().max(100).optional(),
  city: z.string().min(1).max(60),
  region: z.string().regex(/^[A-Z]{2}$/, "Use the 2-letter state"),
  postalCode: z.string().regex(/^\d{5}(-\d{4})?$/),
  country: z.literal("US"),
});

/** Twilio's business types for a STANDARD brand. */
export const businessType = z.enum([
  "Co-operative",
  "Corporation",
  "Limited Liability Corporation",
  "Non-profit Corporation",
  "Partnership",
]);
export type BusinessType = z.infer<typeof businessType>;

/** Twilio's business industries. */
export const businessIndustry = z.enum([
  "AGRICULTURE", "AUTOMOTIVE", "BANKING", "CONSTRUCTION", "CONSUMER", "EDUCATION", "ELECTRONICS", "ENGINEERING", "ENERGY",
  "FAST_MOVING_CONSUMER_GOODS", "FINANCIAL", "FINTECH", "FOOD_AND_BEVERAGE", "GOVERNMENT", "HEALTHCARE", "HOSPITALITY",
  "INSURANCE", "JEWELRY", "LEGAL", "MANUFACTURING", "MEDIA", "NOT_FOR_PROFIT", "OIL_AND_GAS", "ONLINE",
  "PROFESSIONAL_SERVICES", "RAW_MATERIALS", "REAL_ESTATE", "RELIGION", "RETAIL", "TECHNOLOGY", "TELECOMMUNICATIONS",
  "TRANSPORTATION", "TRAVEL",
]);
export type BusinessIndustry = z.infer<typeof businessIndustry>;

const smsSetupBusiness = z.strictObject({
  /** Exactly as on the IRS CP 575. */
  legalName: z.string().min(2).max(255),
  businessType,
  industry: businessIndustry,
  ein: z.string().regex(/^\d{2}-\d{7}$/, "EIN must look like 12-3456789"),
  websiteUrl: z.url().max(255).refine((u) => u.startsWith("https://"), "The website must start with https://"),
  companyType: z.enum(["private", "public", "non-profit"]),
  stockExchange: z.string().min(1).max(20).optional(),
  stockTicker: z.string().min(1).max(10).optional(),
  brandContactEmail: smsSetupEmail.optional(),
  address: smsSetupAddress,
});

const smsSetupAuthorizedRep = z.strictObject({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  businessTitle: z.string().min(1).max(60),
  jobPosition: z.enum(["Director", "GM", "VP", "CEO", "CFO", "General Counsel", "Other"]),
  phone: smsSetupE164Us,
  email: smsSetupEmail,
});

const smsSetupSoleProprietor = z.strictObject({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  brandName: z.string().min(2).max(255),
  email: smsSetupEmail,
  phone: smsSetupE164Us,
  /** Receives Twilio's YES text; can't be a Twilio/CPaaS number; ≤ 3 uses across TCR. */
  mobilePhone: smsSetupE164Us,
  address: smsSetupAddress,
});

/**
 * POST /api/provisioning/sms-registration body. Strict: an unknown key (e.g.
 * `attachToBusiness`) is `400 invalid_field`.
 *
 * STANDARD: a team shares one business registration. The team's FIRST loan
 * officer sends `business` + `authorizedRep`; a 2nd+ loan officer omits both.
 * Whether the tenant already has a business registration is a DB fact, so the
 * ROUTE decides the branch server-side (never a client flag):
 *   no business row, no business block   → 400 field "business"
 *   business row exists, block sent       → 400 field "business" (never merged or overwritten)
 * Here, the two blocks travel together or not at all.
 *
 * SOLE_PROPRIETOR: `soleProprietor` is required; an LLC business type is refused
 * on `brandType` ("An LLC must register with its EIN.") as the FIRST issue.
 */
export const smsRegistrationRequest = z
  .strictObject({
    tenantId: smsSetupId,
    relloAgentId: smsSetupId,
    brandType: z.enum(["STANDARD", "SOLE_PROPRIETOR"]),
    business: smsSetupBusiness.optional(),
    authorizedRep: smsSetupAuthorizedRep.optional(),
    soleProprietor: smsSetupSoleProprietor.optional(),
  })
  .superRefine((b, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    if (b.brandType === "STANDARD") {
      if (b.business && !b.authorizedRep) issue(["authorizedRep"], "An authorized representative is required with the business details");
      if (b.authorizedRep && !b.business) issue(["business"], "Business details are required with an authorized representative");
      if (b.soleProprietor) issue(["soleProprietor"], "Send either the EIN details or the sole-proprietor details, not both");
      if (b.business?.companyType === "public" && !(b.business.stockExchange && b.business.stockTicker && b.business.brandContactEmail))
        issue(["business", "stockExchange"], "A public company needs its stock exchange, ticker and a brand contact email");
    } else {
      if (b.business?.businessType === "Limited Liability Corporation") issue(["brandType"], "An LLC must register with its EIN.");
      if (b.business || b.authorizedRep) issue(["business"], "Send either the EIN details or the sole-proprietor details, not both");
      if (!b.soleProprietor) issue(["soleProprietor"], "Sole-proprietor details are required");
    }
  });
export type SmsRegistrationRequest = z.infer<typeof smsRegistrationRequest>;

/** POST /api/provisioning/sms-registration/otp body (sole proprietor: send a new code). */
export const smsOtpRequest = z.strictObject({ tenantId: smsSetupId, relloAgentId: smsSetupId });
export type SmsOtpRequest = z.infer<typeof smsOtpRequest>;

/**
 * `number_pending`: the team's business is approved; this loan officer's number
 * is being set up.
 * `suspended`: the brand or campaign is suspended at Twilio. Not terminal, no
 * refund, no new charge. A LIVE loan officer on a suspended business also
 * DISPLAYS `suspended` with `phoneNumber: null` (its row stays live for money,
 * is never refunded, and shows `live` again on reinstatement).
 * A suspension FINAL adds no status: waiting loan officers read `rejected`, then
 * `refunded`. An ambiguous provider create adds no status either.
 */
export const smsRegistrationStatus = z.enum([
  "details_received",
  "payment_pending",
  "submitted",
  "brand_pending",
  "brand_approved",
  "otp_pending",
  "campaign_pending",
  "number_pending",
  "live",
  "action_needed",
  "suspended",
  "rejected",
  "refunded",
]);
export type SmsRegistrationStatus = z.infer<typeof smsRegistrationStatus>;

/** The registration envelope: sms.registration_changed `data`, the registration and OTP route answers, and the GET. */
export const smsRegistrationEnvelope = z.strictObject({
  tenantId: smsSetupId,
  relloAgentId: smsSetupId,
  brandType: z.enum(["STANDARD", "SOLE_PROPRIETOR"]),
  status: smsRegistrationStatus,
  /** Twilio's code + text, sanitized. */
  reason: z.string().max(1000).nullable(),
  fieldsToFix: z.array(z.string()).nullable(),
  /** STANDARD: 3 − the BUSINESS's used count (shared by the team); SOLE_PROPRIETOR: null. */
  remainingFreeUpdates: z.number().int().min(0).max(3).nullable(),
  /** Only when `live`. */
  phoneNumber: z.string().regex(/^\+1\d{10}$/).nullable(),
  /** Only for SOLE_PROPRIETOR. Expires 24 h after; a new code is available 60 s after. */
  otpSentAt: smsSetupTime.nullable(),
  rev: smsSetupRev,
  occurredAt: smsSetupTime,
});
export type SmsRegistrationEnvelope = z.infer<typeof smsRegistrationEnvelope>;

/**
 * 409 on POST sms-registration and POST sms-registration/otp:
 *   business_rejected         the business is rejected; send the business details again (RENEW)
 *   business_suspended        suspended at Twilio; no write, no charge, no Twilio call
 *   business_suspension_final GD-1763: closed by the carriers; ANY body is refused until Rello's
 *                             operator records the provider outcome; then fresh business details renew once
 *   in_review                 submitted … campaign_pending, otp_pending, live
 *   no_free_updates           action_needed on a brand fix with 0 free updates left
 *   not_otp_pending           OTP route: the registration is not waiting for a code
 * `envelope` is null only when this MLO has no registration row yet.
 * Other answers: 400 invalid_field · 401 · 403 · 404 agent_not_found ·
 * 409 { error: "agent_not_eligible" } · OTP 429 { error: "otp_recently_sent", retryAfterSeconds } ·
 * OTP 502 { error: "twilio_unavailable", retryable: true } · 500 internalError.
 */
export const registrationConflict = z.strictObject({
  error: z.enum(["business_rejected", "business_suspended", "business_suspension_final", "in_review", "no_free_updates", "not_otp_pending"]),
  envelope: smsRegistrationEnvelope.nullable(),
});
export type RegistrationConflict = z.infer<typeof registrationConflict>;

// ═══ Events on Rello's billing outbox (HMAC-SHA256 over the raw body) ═══════

/** Envelope occurredAt = data.occurredAt. */
export const setupChargeChangedEvent = z.strictObject({
  id: z.uuid(),
  type: z.literal("billing.setup_charge_changed"),
  tenantId: smsSetupId,
  occurredAt: smsSetupTime,
  data: setupChargeEnvelope,
});
export type SetupChargeChangedEvent = z.infer<typeof setupChargeChangedEvent>;

export const smsRegistrationChangedEvent = z.strictObject({
  id: z.uuid(),
  type: z.literal("sms.registration_changed"),
  tenantId: smsSetupId,
  occurredAt: smsSetupTime,
  data: smsRegistrationEnvelope,
});
export type SmsRegistrationChangedEvent = z.infer<typeof smsRegistrationChangedEvent>;
