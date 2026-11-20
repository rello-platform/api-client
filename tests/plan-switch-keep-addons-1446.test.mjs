import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../dist/index.js";

// Platform KA prompt 1446, part 2 (PFP gateway plan switch G-10R-2b, K1: keep Refi Radar through a
// Pro -> Starter switch). Four additive changes to the plan-switch contract, plus a prose fix:
//   planSwitchPreviewQuerySchema  + keepAddOns: "refi-radar"            (optional; absent = drop)
//   planSwitchRequestSchema       + keepAddOns: ["refi-radar"] (max 1)  (optional)
//   preview chargeChange          + refiRadarKept: boolean              (optional)
//   PLAN_SWITCH_ERROR_CODES       + addon_not_offered                   (400)
// Optional fields stay optional: an old caller's request and an old server's response must both still
// parse, with nothing added to them. Both directions are tested.

const PREVIEW_OLD_SERVER = {
  previewId: "pv_1",
  expiresAt: "2026-11-17T12:15:00.000Z",
  prorationDate: "2026-11-17T12:00:00.000Z",
  requiresConfirmation: true,
  subscriptions: [
    {
      kind: "plan",
      lines: [{ description: "Starter", amount: 2900, currency: "usd", period: { start: "2026-11-17T12:00:00.000Z", end: "2026-12-01T00:00:00.000Z" }, proration: true }],
      total: 2900,
    },
  ],
  planChange: { from: "pfp-pro", to: "pfp-starter", fromInterval: "month", toInterval: "month" },
  chargeChange: { carriedCheckYourRateSeat: true, refiRadarDrops: true },
};
const withKept = (refiRadarKept) => ({ ...PREVIEW_OLD_SERVER, chargeChange: { ...PREVIEW_OLD_SERVER.chargeChange, refiRadarDrops: !refiRadarKept, refiRadarKept } });

test("keep list: PLAN_SWITCH_KEEP_ADDONS is exactly refi-radar", () => {
  assert.deepEqual([...(api.PLAN_SWITCH_KEEP_ADDONS ?? [])], ["refi-radar"]);
});

test("preview query: keepAddOns is optional (absent = drop, nothing added), accepts refi-radar, refuses anything else; still strict", () => {
  const s = api.planSwitchPreviewQuerySchema;
  const old = s.safeParse({ targetPlanSlug: "pfp-starter" });
  assert.equal(old.success, true, "an old caller's query still parses");
  assert.deepEqual(old.data, { targetPlanSlug: "pfp-starter" }, "no keepAddOns key appears");
  assert.deepEqual(s.safeParse({ targetPlanSlug: "pfp-starter", interval: "year" }).data, { targetPlanSlug: "pfp-starter", interval: "year" });
  assert.deepEqual(s.safeParse({ targetPlanSlug: "pfp-starter", keepAddOns: "refi-radar" }).data, { targetPlanSlug: "pfp-starter", keepAddOns: "refi-radar" });
  for (const bad of ["check-your-rate", "", "REFI-RADAR", 1, null, ["refi-radar"]]) {
    assert.equal(s.safeParse({ targetPlanSlug: "pfp-starter", keepAddOns: bad }).success, false, JSON.stringify(bad));
  }
  assert.equal(s.safeParse({ targetPlanSlug: "pfp-starter", keepaddons: "refi-radar" }).success, false, "unknown keys are still refused");
});

test("request body: keepAddOns is optional (old body parses unchanged), an array of refi-radar, at most one", () => {
  const s = api.planSwitchRequestSchema;
  const oldBody = { targetPlanSlug: "pfp-starter", idempotencyKey: "pfp-switch-0001", previewId: "pv_1", confirmedChargeChange: true };
  const old = s.safeParse(oldBody);
  assert.equal(old.success, true, "an old caller's request still parses");
  assert.deepEqual(old.data, oldBody, "nothing is added to it");
  assert.equal("keepAddOns" in old.data, false);
  assert.deepEqual(s.safeParse({ ...oldBody, keepAddOns: ["refi-radar"] }).data, { ...oldBody, keepAddOns: ["refi-radar"] });
  assert.equal(s.safeParse({ ...oldBody, keepAddOns: [] }).success, true, "an empty list is the same as absent");
  assert.equal(s.safeParse({ ...oldBody, keepAddOns: undefined }).success, true);
  assert.equal(s.safeParse({ ...oldBody, keepAddOns: ["refi-radar", "refi-radar"] }).success, false, "max 1");
  for (const bad of [["check-your-rate"], ["refi-radar", "x"], "refi-radar", [""], [1], null]) {
    assert.equal(s.safeParse({ ...oldBody, keepAddOns: bad }).success, false, JSON.stringify(bad));
  }
  assert.equal(s.safeParse({ ...oldBody, keep: ["refi-radar"] }).success, false, "still strict");
});

test("preview response: an old server's chargeChange (no refiRadarKept) parses unchanged; a new one keeps refiRadarKept; a non-boolean is refused", () => {
  const s = api.planSwitchPreviewResponseSchema;
  const old = s.safeParse(PREVIEW_OLD_SERVER);
  assert.equal(old.success, true, JSON.stringify(old.error?.issues));
  assert.deepEqual(old.data.chargeChange, { carriedCheckYourRateSeat: true, refiRadarDrops: true });
  assert.equal("refiRadarKept" in old.data.chargeChange, false, "absent stays absent: never read as false");
  for (const kept of [true, false]) {
    const r = s.safeParse(withKept(kept));
    assert.equal(r.success, true, JSON.stringify(r.error?.issues));
    assert.equal(r.data.chargeChange.refiRadarKept, kept);
  }
  assert.equal(s.safeParse({ ...PREVIEW_OLD_SERVER, chargeChange: { ...PREVIEW_OLD_SERVER.chargeChange, refiRadarKept: "yes" } }).success, false);
  assert.equal(s.safeParse({ ...PREVIEW_OLD_SERVER, chargeChange: { carriedCheckYourRateSeat: true } }).success, false, "the two existing fields stay required");
});

test("error code: addon_not_offered is in PLAN_SWITCH_ERROR_CODES, parses as a 400 body through the open branch, is not dedicated", () => {
  assert.ok(api.PLAN_SWITCH_ERROR_CODES.includes("addon_not_offered"), "addon_not_offered missing");
  assert.equal(api.PLAN_SWITCH_DEDICATED_ERROR_CODES.includes("addon_not_offered"), false);
  assert.equal(new Set(api.PLAN_SWITCH_ERROR_CODES).size, api.PLAN_SWITCH_ERROR_CODES.length, "no duplicate");
  const r = api.planSwitchErrorSchema.safeParse({ error: "addon_not_offered", message: "Refi Radar is not on this account." });
  assert.equal(r.success, true);
  assert.equal(r.data.error, "addon_not_offered");
  assert.equal(api.planSwitchErrorSchema.safeParse({ error: "addon_not_offered" }).success, true, "message stays optional");
  // the 18 codes that existed before are all still there
  for (const code of ["invalid_body", "idempotency_key_reused", "switch_not_allowed", "contact_sales", "members_exceed_target", "addon_price_not_configured", "billing_mode_classic", "already_on_plan", "confirmation_required", "preview_stale", "preview_consumed", "stale_switch", "switch_in_progress", "payment_failed", "provider_unreadable", "not_armed", "use_plan_switch", "operation_not_found"]) {
    assert.ok(api.PLAN_SWITCH_ERROR_CODES.includes(code), `${code} stays`);
  }
  // v2.45.0 appended no_plan_subscription; tests/plan-switch-methods-1545.test.mjs pins the full list of 20.
  assert.ok(api.PLAN_SWITCH_ERROR_CODES.length >= 19, "the 19 codes of v2.42.0 stay");
});

test("prose (GD-2346): provider_changed no longer says 'One GET'; it says the shared reader's two reads, each <= 1 bounded retry, 0 mutations", () => {
  const src = readFileSync(new URL("../src/types/billing-switch.ts", import.meta.url), "utf8");
  assert.equal(src.includes("One GET, 0 mutations"), false, "the old claim is gone");
  assert.match(src, /[Tt]he shared reader's two reads, each ≤ 1 bounded retry; 0 mutations/, "the corrected claim is there");
});
