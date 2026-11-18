import { test } from "node:test";
import assert from "node:assert/strict";
import * as api from "../dist/index.js";

// AUDIT 111 GD-2250 (KA 1325): the exported add-on start-error vocabulary named
// addon_pricing_not_configured and omitted addon_price_not_configured, the code
// Rello main sends. PathfinderPro classifies Rello's refusals with this list.

// Shaped exactly as Rello main answers a TEAM tenant with no TEAM monthly price:
// route.ts:113-116 returns { success: false, error: started.message,
// code: started.code, ...started.extra }; cyr-price.ts pickCyrPrice builds
// message + extra { family, interval, addOnId } (HTTP 409).
const RELLO_REFUSAL = {
  success: false,
  error:
    "This add-on has no TEAM monthly price, so it can't be started on a monthly plan. " +
    "Enter it in Platform Admin → Billing → Add-ons; nothing was changed.",
  code: "addon_price_not_configured",
  family: "TEAM",
  interval: "month",
  addOnId: "addon_cyr_engine_1",
};

test("GD-2250: Rello's addon_price_not_configured refusal parses, keeps family/interval/addOnId, and is a listed code", () => {
  const r = api.addOnStartErrorSchema.safeParse(RELLO_REFUSAL);
  assert.equal(r.success, true);
  assert.equal(r.data.code, "addon_price_not_configured");
  assert.equal(r.data.family, "TEAM");
  assert.equal(r.data.interval, "month");
  assert.equal(r.data.addOnId, "addon_cyr_engine_1");
  assert.ok(api.ADD_ON_START_ERROR_CODES.includes(r.data.code), "the exported list names the code Rello sends");
});

test("GD-2250: the retired spelling addon_pricing_not_configured is no longer listed (nothing in Rello main sends it)", () => {
  assert.equal(api.ADD_ON_START_ERROR_CODES.includes("addon_pricing_not_configured"), false);
  // A body carrying it still parses: `code` stays an open string.
  assert.equal(api.addOnStartErrorSchema.safeParse({ ...RELLO_REFUSAL, code: "addon_pricing_not_configured" }).success, true);
});

test("GD-2250: the other start codes are unchanged and the list has no duplicates", () => {
  const codes = [...api.ADD_ON_START_ERROR_CODES];
  assert.equal(new Set(codes).size, codes.length);
  for (const c of [
    "not_a_check_your_rate_addon", "payment_method_required", "tenant_not_found", "addon_already_active",
    "addon_state_unknown", "already_entitled", "engine_required", "trial_already_used", "stripe_failed",
  ]) assert.ok(codes.includes(c), c);
});
