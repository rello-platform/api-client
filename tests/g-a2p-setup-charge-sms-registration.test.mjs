import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as api from "../dist/index.js";

// PFP Gateway G-SETUP + G-A2P (v2.34.0): the setup-charge and texting-registration
// contract between Rello's routes and PathfinderPro's callers. Plan a6-1143
// (Platform KA prompts 1143 / 1160 / 1172): §D.1 charge lane, §D.2 registration
// lane, §D.4 events; the 2044Z contract pins (a: the fee GET, b: attach is
// server-decided); H-173 (quoteVersion, 409 fee_changed); GD-1763 (409
// business_suspension_final, no new wire status); GD-1761 (no wire status for an
// ambiguous provider create).
//
// Every schema is looked up by name, so a missing export fails its own test
// instead of stopping the file.

const now = new Date().toISOString();
const uuid = "00000000-0000-4000-8000-000000000001";

function schema(name) {
  const s = api[name];
  assert.ok(s && typeof s.safeParse === "function", `${name} is not exported`);
  return s;
}
const parses = (name, value) => schema(name).safeParse(value);
const issuesAt = (result, field) => !result.success && result.error.issues.some((i) => i.path[0] === field);

const chargeEnv = (status, over = {}) => ({
  tenantId: "t1", relloAgentId: "a1", feeSlug: "rate-check-text-setup", status, chargeId: "c1", rev: 3, occurredAt: now, ...over,
});
const regEnv = (status, phoneNumber = null, over = {}) => ({
  tenantId: "t1", relloAgentId: "a1", brandType: "STANDARD", status,
  reason: status === "suspended" ? "Twilio suspended the campaign (21729)" : null,
  fieldsToFix: null, remainingFreeUpdates: 2, phoneNumber, otpSentAt: null, rev: 9, occurredAt: now, ...over,
});
const quote = {
  feeSlug: "rate-check-text-setup", label: "Rate Check by text setup", amountCents: 9900, currency: "usd", isActive: true, quoteVersion: 4,
};
const chargeReq = { tenantId: "t1", relloAgentId: "a1", feeSlug: "rate-check-text-setup", quoteVersion: 4 };

const address = { street: "1 Main St", city: "Salt Lake City", region: "UT", postalCode: "84101", country: "US" };
const business = {
  legalName: "Acme Lending LLC", businessType: "Limited Liability Corporation", industry: "FINANCIAL", ein: "12-3456789",
  websiteUrl: "https://acme.example", companyType: "private", address,
};
const authorizedRep = {
  firstName: "Ann", lastName: "Rep", businessTitle: "Owner", jobPosition: "CEO", phone: "+18015550101", email: "ann@acme.example",
};
const soleProprietor = {
  firstName: "Sam", lastName: "Solo", brandName: "Sam Solo Lending", email: "sam@example.com",
  phone: "+18015550102", mobilePhone: "+18015550103", address,
};

// ── D.1 charge lane ─────────────────────────────────────────────────────────

test("setup-charge status: exactly the 7 wire values; every one parses in the envelope and the event", () => {
  const statuses = ["pending", "paid", "failed", "unknown", "manual", "refunded", "voided"];
  assert.deepEqual([...schema("setupChargeStatus").options], statuses);
  for (const status of statuses) {
    assert.equal(parses("setupChargeEnvelope", chargeEnv(status)).success, true, status);
    const ev = parses("setupChargeChangedEvent", { id: uuid, type: "billing.setup_charge_changed", tenantId: "t1", occurredAt: now, data: chargeEnv(status) });
    assert.equal(ev.success, true, `event ${status}`);
  }
  assert.equal(parses("setupChargeEnvelope", chargeEnv("void")).success, false, "an 8th value is refused");
  assert.equal(parses("setupChargeEnvelope", { ...chargeEnv("paid"), amountCents: 9900 }).success, false, "unknown key refused");
});

test("H-173: quoteVersion is required on the quote and on the POST body (path quoteVersion); the POST never takes an amount", () => {
  assert.equal(parses("oneTimeFeeQuote", quote).success, true);
  const { quoteVersion: _drop, ...noVersion } = quote;
  assert.equal(parses("oneTimeFeeQuote", noVersion).success, false, "quote without quoteVersion");
  assert.equal(parses("oneTimeFeeQuote", { ...quote, quoteVersion: 0 }).success, false, "quoteVersion 0");
  assert.equal(parses("oneTimeFeeQuote", { ...quote, quoteVersion: 1.5 }).success, false, "quoteVersion not an integer");
  assert.equal(parses("setupChargeRequest", chargeReq).success, true);
  const { quoteVersion: _v, ...reqNoVersion } = chargeReq;
  const missing = parses("setupChargeRequest", reqNoVersion);
  assert.equal(issuesAt(missing, "quoteVersion"), true, JSON.stringify(missing.error?.issues));
  assert.equal(parses("setupChargeRequest", { ...chargeReq, amountCents: 100 }).success, false, "a client amount is an unknown key");
  assert.equal(parses("setupChargeRequest", { ...chargeReq, quoteVersion: "4" }).success, false, "a string version is refused");
});

test("H-173: 409 fee_changed carries the CURRENT quote (also isActive:false); fee_inactive is gone", () => {
  assert.equal(parses("feeChangedConflict", { error: "fee_changed", quote: { ...quote, amountCents: 12900, quoteVersion: 5 } }).success, true);
  assert.equal(parses("feeChangedConflict", { error: "fee_changed", quote: { ...quote, isActive: false, quoteVersion: 5 } }).success, true);
  assert.equal(parses("feeChangedConflict", { error: "fee_changed" }).success, false, "quote is required");
  assert.equal(parses("feeChangedConflict", { error: "fee_changed", quote: null }).success, false, "quote is never null");
  assert.equal(parses("feeChangedConflict", { error: "fee_inactive", quote }).success, false, "fee_inactive is not a code");
  assert.equal(parses("chargeConflict", { error: "fee_inactive", envelope: null }).success, false, "fee_inactive is not a charge conflict either");
});

test("pin a: the fee GET is contract (feeSlugQuery, oneTimeFeeQuote, feeNotFound, internalError)", () => {
  assert.equal(parses("feeSlugQuery", { feeSlug: "rate-check-text-setup" }).success, true);
  assert.equal(issuesAt(parses("feeSlugQuery", { feeSlug: "Rate Check" }), "feeSlug"), true, "malformed slug → field feeSlug");
  assert.equal(issuesAt(parses("feeSlugQuery", {}), "feeSlug"), true, "missing slug → field feeSlug");
  assert.equal(parses("feeSlugQuery", { feeSlug: "rate-check-text-setup", tenantId: "t1" }).success, false, "the tenant comes from the key");
  assert.equal(parses("feeNotFound", { error: "fee_not_found" }).success, true);
  assert.equal(parses("feeNotFound", { error: "not_found" }).success, false);
  assert.equal(parses("internalError", { error: "internal", requestId: "req_1" }).success, true);
  assert.equal(parses("internalError", { error: "internal" }).success, false, "500 needs requestId");
  assert.equal(parses("oneTimeFeeQuote", { ...quote, amountCents: 0 }).success, false, "never a zero/default price");
  assert.equal(parses("oneTimeFeeQuote", { ...quote, currency: "USD" }).success, false, "currency is lower-case ISO");
  assert.equal(parses("oneTimeFeeQuote", { ...quote, cached: true }).success, false, "unknown key refused");
});

test("charge 409s: chargeConflict codes, business_suspension_final with the envelope or null (GD-1763)", () => {
  for (const error of ["registration_rejected", "refund_in_progress", "business_suspended", "business_suspension_final"]) {
    assert.equal(parses("chargeConflict", { error, envelope: chargeEnv("refunded") }).success, true, error);
  }
  assert.equal(parses("chargeConflict", { error: "business_suspension_final", envelope: null }).success, true, "no charge row → null");
  assert.equal(parses("chargeConflict", { error: "business_suspension_final" }).success, false, "envelope key is required (null, not absent)");
  assert.equal(parses("chargeConflict", { error: "suspension_final", envelope: null }).success, false);
});

// ── D.2 registration lane ───────────────────────────────────────────────────

test("pin b: a bare 2nd+ MLO STANDARD body parses (the route decides CREATE 400 / ATTACH); attachToBusiness is an unknown key", () => {
  const bare = { tenantId: "t1", relloAgentId: "a2", brandType: "STANDARD" };
  assert.equal(parses("smsRegistrationRequest", bare).success, true);
  const att = parses("smsRegistrationRequest", { ...bare, attachToBusiness: true });
  assert.equal(att.success, false);
  assert.equal(att.error.issues.some((i) => i.code === "unrecognized_keys"), true, JSON.stringify(att.error.issues));
});

test("registration body: the business pair travels together; LLC + sole prop names brandType; SP needs its block", () => {
  const std = { tenantId: "t1", relloAgentId: "a1", brandType: "STANDARD" };
  assert.equal(parses("smsRegistrationRequest", { ...std, business, authorizedRep }).success, true, "first MLO: business + rep");
  assert.equal(issuesAt(parses("smsRegistrationRequest", { ...std, business }), "authorizedRep"), true, "business without rep");
  assert.equal(issuesAt(parses("smsRegistrationRequest", { ...std, authorizedRep }), "business"), true, "rep without business");
  assert.equal(issuesAt(parses("smsRegistrationRequest", { ...std, business, authorizedRep, soleProprietor }), "soleProprietor"), true);
  const pub = parses("smsRegistrationRequest", { ...std, business: { ...business, companyType: "public" }, authorizedRep });
  assert.equal(pub.success, false, "a public company needs exchange, ticker and brand contact email");

  const sp = { tenantId: "t1", relloAgentId: "a3", brandType: "SOLE_PROPRIETOR" };
  assert.equal(parses("smsRegistrationRequest", { ...sp, soleProprietor }).success, true);
  assert.equal(issuesAt(parses("smsRegistrationRequest", sp), "soleProprietor"), true, "SP block required");
  const llc = parses("smsRegistrationRequest", { ...sp, soleProprietor, business });
  assert.equal(llc.success, false);
  assert.deepEqual(llc.error.issues[0].path, ["brandType"], "the LLC issue comes first and names brandType");
  assert.equal(llc.error.issues[0].message, "An LLC must register with its EIN.");
  assert.equal(parses("smsRegistrationRequest", { ...std, business: { ...business, ein: "123456789" }, authorizedRep }).success, false, "EIN shape");
  assert.equal(parses("smsRegistrationRequest", { ...std, business: { ...business, websiteUrl: "http://acme.example" }, authorizedRep }).success, false, "https only");
  assert.equal(parses("smsOtpRequest", { tenantId: "t1", relloAgentId: "a3" }).success, true);
  assert.equal(parses("smsOtpRequest", { tenantId: "t1", relloAgentId: "a3", code: "123456" }).success, false);
});

test("registration status: the 13 wire values incl. number_pending and suspended; no suspension_final / ambiguous_create on the wire", () => {
  const statuses = ["details_received", "payment_pending", "submitted", "brand_pending", "brand_approved", "otp_pending",
    "campaign_pending", "number_pending", "live", "action_needed", "suspended", "rejected", "refunded"];
  assert.deepEqual([...schema("smsRegistrationStatus").options], statuses);
  for (const status of statuses) assert.equal(parses("smsRegistrationEnvelope", regEnv(status)).success, true, status);
  assert.equal(parses("smsRegistrationEnvelope", regEnv("suspension_final")).success, false, "GD-1763: no new status");
  assert.equal(parses("smsRegistrationEnvelope", regEnv("ambiguous_create")).success, false, "GD-1761: no wire status");
  assert.equal(parses("smsRegistrationEnvelope", regEnv("live", "+18015550101")).success, true, "live carries the number");
  assert.equal(parses("smsRegistrationEnvelope", regEnv("suspended", null)).success, true, "LIVE on a suspended business displays suspended, number null");
  assert.equal(parses("smsRegistrationEnvelope", regEnv("live", null, { remainingFreeUpdates: 4 })).success, false, "≤ 3 free updates");
  const ev = parses("smsRegistrationChangedEvent", { id: uuid, type: "sms.registration_changed", tenantId: "t1", occurredAt: now, data: regEnv("number_pending") });
  assert.equal(ev.success, true, JSON.stringify(ev.error?.issues));
  assert.equal(parses("smsRegistrationChangedEvent", { id: "not-a-uuid", type: "sms.registration_changed", tenantId: "t1", occurredAt: now, data: regEnv("live") }).success, false);
});

test("registration 409s: registrationConflict carries business_suspension_final with the envelope (rejected / refunded) or null", () => {
  for (const status of ["rejected", "refunded"]) {
    assert.equal(parses("registrationConflict", { error: "business_suspension_final", envelope: regEnv(status) }).success, true, status);
  }
  assert.equal(parses("registrationConflict", { error: "business_suspension_final", envelope: null }).success, true, "a new MLO with no row");
  for (const error of ["business_rejected", "business_suspended", "in_review", "no_free_updates", "not_otp_pending"]) {
    assert.equal(parses("registrationConflict", { error, envelope: regEnv("action_needed") }).success, true, error);
  }
  assert.equal(parses("registrationConflict", { error: "suspension_final", envelope: null }).success, false);
});

test("every exported G-A2P object schema refuses an unknown key", () => {
  const fixtures = {
    setupChargeRequest: chargeReq,
    setupChargeEnvelope: chargeEnv("paid"),
    feeSlugQuery: { feeSlug: "rate-check-text-setup" },
    oneTimeFeeQuote: quote,
    feeChangedConflict: { error: "fee_changed", quote },
    feeNotFound: { error: "fee_not_found" },
    internalError: { error: "internal", requestId: "r1" },
    chargeConflict: { error: "refund_in_progress", envelope: chargeEnv("paid") },
    smsRegistrationRequest: { tenantId: "t1", relloAgentId: "a2", brandType: "STANDARD" },
    smsOtpRequest: { tenantId: "t1", relloAgentId: "a3" },
    smsRegistrationEnvelope: regEnv("live", "+18015550101"),
    registrationConflict: { error: "in_review", envelope: regEnv("brand_pending") },
    setupChargeChangedEvent: { id: uuid, type: "billing.setup_charge_changed", tenantId: "t1", occurredAt: now, data: chargeEnv("paid") },
    smsRegistrationChangedEvent: { id: uuid, type: "sms.registration_changed", tenantId: "t1", occurredAt: now, data: regEnv("live", "+18015550101") },
  };
  for (const [name, fixture] of Object.entries(fixtures)) {
    const good = parses(name, fixture);
    assert.equal(good.success, true, `${name}: ${JSON.stringify(good.error?.issues)}`);
    assert.equal(parses(name, { ...fixture, extra: 1 }).success, false, `${name} accepted an unknown key`);
  }
});

test("admin (§D.3) bodies are Rello-internal and not exported", () => {
  for (const name of ["oneTimeFeeCreate", "oneTimeFeePatch", "manualChargeSettle", "campaignFinal", "refundRetry",
    "suspensionOutcome", "suspensionReplacement", "providerCreateOutcome"]) {
    assert.equal(name in api, false, `${name} is exported`);
  }
});

// ── permissions re-pin v0.60.0 → v0.62.0 ────────────────────────────────────

test("type: the guard accepts billing:setup-charge:write, sms:registration:write and billing:plan-switch:write", () => {
  const fixture = fileURLToPath(new URL("./types/g-a2p-permissions.fixture.ts", import.meta.url));
  const program = ts.createProgram([fixture], {
    strict: true, noEmit: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ["lib.es2020.d.ts", "lib.dom.d.ts"], skipLibCheck: true, types: [],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => {
    const where = d.file && d.start !== undefined ? `${d.file.fileName}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1} ` : "";
    return `${where}TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
  });
  assert.deepEqual(diagnostics, []);
});
