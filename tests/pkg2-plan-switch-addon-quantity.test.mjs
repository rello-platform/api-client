import { test } from "node:test";
import assert from "node:assert/strict";
import * as api from "../dist/index.js";

// PFP Gateway PKG-2 (G-10R + G-EXTRAS, plan a7-1147 §F/§H/§P; Platform KA
// prompt 1199). The types every later G-10R PR imports:
//  1. the plan-switch preview query/response (previewId, expiresAt, requiresConfirmation);
//  2. the plan-switch POST body (previewId + confirmedChargeChange) and its error union,
//     incl. preview_stale with an optional reason;
//  3. addOns on the tenant enable payload;
//  4. the generic add-on quantity PATCH: body, response (subscriptionCanceled?) and
//     its error union incl. extra_mlos_exceed_quantity.

const cyr = (over = {}) => ({
  featureSlug: "check-your-rate",
  status: "ACTIVE",
  quantity: 2,
  trialEndsAt: null,
  canceledAt: null,
  occurredAt: "2026-11-16T23:00:00.000Z",
  seq: 4,
  source: "addon",
  ...over,
});

test("preview query: targetPlanSlug required and trimmed, interval month|year, strict", () => {
  const s = api.planSwitchPreviewQuerySchema;
  assert.ok(s, "planSwitchPreviewQuerySchema missing");
  const r = s.safeParse({ targetPlanSlug: " pfp-starter ", interval: "year" });
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.deepEqual(r.data, { targetPlanSlug: "pfp-starter", interval: "year" });
  assert.equal(s.safeParse({ targetPlanSlug: "pfp-starter" }).success, true, "interval is optional (default: the current one)");
  assert.equal(s.safeParse({ targetPlanSlug: "" }).success, false);
  assert.equal(s.safeParse({ targetPlanSlug: "pfp-starter", interval: "week" }).success, false);
  assert.equal(s.safeParse({ targetPlanSlug: "pfp-starter", relloTenantId: "t1" }).success, false, "the tenant never comes from the caller");
});

test("POST body: previewId and confirmedChargeChange ride along; the tenant never does", () => {
  const s = api.planSwitchRequestSchema;
  assert.ok(s, "planSwitchRequestSchema missing");
  const ok = { targetPlanSlug: "pfp-starter", interval: "month", idempotencyKey: "switch-12345678", previewId: "pv_1", confirmedChargeChange: true };
  const r = s.safeParse(ok);
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.deepEqual(r.data, ok);
  assert.equal(s.safeParse({ targetPlanSlug: "pfp-pro", idempotencyKey: "switch-12345678" }).success, true, "an upgrade needs no preview");
  assert.equal(s.safeParse({ ...ok, relloTenantId: "t1" }).success, false, "strict: no relloTenantId");
  assert.equal(s.safeParse({ ...ok, refiRadar: false }).success, false, "strict: the D47 options are fixed server-side");
  assert.equal(s.safeParse({ ...ok, idempotencyKey: "short" }).success, false, "idempotencyKey 8..200");
  assert.equal(s.safeParse({ ...ok, idempotencyKey: "k".repeat(201) }).success, false);
  assert.equal(s.safeParse({ ...ok, previewId: "" }).success, false);
});

test("POST body: a non-boolean confirmedChargeChange still parses, so switchPlan() answers confirmation_required, not invalid_body", () => {
  const s = api.planSwitchRequestSchema;
  for (const v of ["true", 1, "yes", {}, null]) {
    const r = s.safeParse({ targetPlanSlug: "pfp-starter", idempotencyKey: "switch-12345678", previewId: "pv_1", confirmedChargeChange: v });
    assert.equal(r.success, true, `confirmedChargeChange=${JSON.stringify(v)} must reach the === true check`);
    assert.notEqual(r.data.confirmedChargeChange, true);
  }
});

test("plan-switch error codes: the whole union, incl. confirmation_required, preview_stale, preview_consumed, use_plan_switch", () => {
  const codes = api.PLAN_SWITCH_ERROR_CODES;
  assert.ok(Array.isArray(codes), "PLAN_SWITCH_ERROR_CODES missing");
  const expected = [
    "invalid_body", "idempotency_key_reused", "switch_not_allowed", "contact_sales", "members_exceed_target",
    "addon_price_not_configured", "billing_mode_classic", "already_on_plan", "confirmation_required",
    "preview_stale", "preview_consumed", "stale_switch", "switch_in_progress", "payment_failed",
    "provider_unreadable", "not_armed", "use_plan_switch", "operation_not_found",
  ];
  // v2.42.0 added addon_not_offered; the exact list is pinned in plan-switch-keep-addons-1446.test.mjs.
  for (const code of expected) assert.ok(codes.includes(code), `${code} stays in the list`);
  assert.equal(new Set(codes).size, codes.length, "no duplicates");
});

test("preview_stale reasons: inputs_changed, provider_changed, expired (optional on the wire)", () => {
  assert.deepEqual([...api.PREVIEW_STALE_REASONS].sort(), ["expired", "inputs_changed", "provider_changed"]);
  const s = api.previewStaleErrorSchema;
  assert.ok(s, "previewStaleErrorSchema missing");
  assert.equal(s.safeParse({ error: "preview_stale" }).success, true, "absent reason = the round-2 meaning");
  for (const reason of api.PREVIEW_STALE_REASONS) {
    const r = s.safeParse({ error: "preview_stale", reason });
    assert.equal(r.success, true, reason);
    assert.equal(r.data.reason, reason);
  }
  const later = s.safeParse({ error: "preview_stale", reason: "a_later_reason" });
  assert.equal(later.success, true, "a reason added later still parses at an older PFP (plain string, like cause)");
  assert.equal(s.safeParse({ error: "preview_consumed" }).success, false);
});

test("tenant enable payload: addOns is an optional array of add-on state records", () => {
  const base = {
    action: "enable",
    relloTenantId: "t1",
    tenant: { name: "T", slug: "t", primaryColor: null, physicalAddress: null, applicationUrl: null, type: "MORTGAGE", plan: "PRO" },
    agents: [],
  };
  const s = api.tenantEnablePayloadSchema;
  const withAddOns = s.safeParse({ ...base, addOns: [cyr(), cyr({ featureSlug: "refi-radar", quantity: 1, seq: 2 })] });
  assert.equal(withAddOns.success, true, JSON.stringify(withAddOns.error?.issues));
  assert.equal(withAddOns.data.addOns.length, 2, "addOns must survive the parse (an unknown key is stripped)");
  assert.equal(withAddOns.data.addOns[1].featureSlug, "refi-radar");
  const without = s.safeParse(base);
  assert.equal(without.success, true);
  assert.equal(without.data.addOns, undefined, "absent = an older Rello, never 'no add-ons'");
  assert.equal(s.safeParse({ ...base, addOns: [cyr({ status: "PAUSED" })] }).success, false);
  assert.equal(s.safeParse({ ...base, addOns: null }).success, false, "an empty list is [], never null");
});

test("add-on quantity PATCH body: quantity >= 0 and quantityRev (number or digit string), strict", () => {
  const s = api.addOnQuantityRequestSchema;
  assert.ok(s, "addOnQuantityRequestSchema missing");
  assert.equal(s.safeParse({ quantity: 0, quantityRev: 3 }).success, true, "0 removes the item");
  assert.equal(s.safeParse({ quantity: 2, quantityRev: "900719925474099300" }).success, true, "a rev past 2^53 travels as a string");
  assert.equal(s.safeParse({ quantity: -1, quantityRev: 3 }).success, false);
  assert.equal(s.safeParse({ quantity: 1.5, quantityRev: 3 }).success, false);
  assert.equal(s.safeParse({ quantity: 1 }).success, false, "quantityRev is required");
  assert.equal(s.safeParse({ quantity: 1, quantityRev: "3a" }).success, false);
  assert.equal(s.safeParse({ quantity: 1, quantityRev: 3, relloTenantId: "t1" }).success, false, "strict: no tenant from the body");
});

test("add-on quantity error codes: the generic union incl. extra_mlos_exceed_quantity, and R1's own codes kept", () => {
  const codes = api.ADDON_QUANTITY_ERROR_CODES;
  assert.ok(Array.isArray(codes), "ADDON_QUANTITY_ERROR_CODES missing");
  const generic = ["members_exceed_quantity", "extra_mlos_exceed_quantity", "stale_quantity_rev", "contact_sales", "included_in_plan", "addon_price_not_configured"];
  const r1 = ["addon_not_found", "addon_not_active", "addon_state_unknown", "quantity_not_supported", "payment_method_required", "stripe_failed"];
  assert.deepEqual([...codes].sort(), [...generic, ...r1].sort());
  assert.equal(new Set(codes).size, codes.length, "no duplicates");
});
