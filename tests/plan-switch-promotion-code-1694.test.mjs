// v2.48.0 (D65 step 3, Platform KA prompt 1694): the optional discount code on the plan switch.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLAN_SWITCH_ERROR_CODES,
  PLAN_SWITCH_PROMOTION_CODE_MAX_LENGTH,
  PREVIEW_STALE_REASONS,
  planSwitchErrorSchema,
  planSwitchPreviewQuerySchema,
  planSwitchPreviewResponseSchema,
  planSwitchRequestSchema,
  previewStaleErrorSchema,
} from "../dist/index.js";

test("query and body take promotionCode; trimmed; empty or blank is absent; too long or not a string is refused", () => {
  assert.deepEqual(planSwitchPreviewQuerySchema.parse({ targetPlanSlug: "rates", promotionCode: " Launch5 " }), { targetPlanSlug: "rates", promotionCode: "Launch5" });
  for (const v of ["", "   "]) assert.equal(planSwitchPreviewQuerySchema.parse({ targetPlanSlug: "rates", promotionCode: v }).promotionCode, undefined);
  assert.equal(planSwitchPreviewQuerySchema.safeParse({ targetPlanSlug: "rates", promotionCode: "x".repeat(PLAN_SWITCH_PROMOTION_CODE_MAX_LENGTH + 1) }).success, false);
  assert.equal(planSwitchRequestSchema.safeParse({ targetPlanSlug: "rates", idempotencyKey: "12345678", promotionCode: 5 }).success, false);
  assert.equal(planSwitchRequestSchema.parse({ targetPlanSlug: "rates", idempotencyKey: "12345678", previewId: "p", promotionCode: "LAUNCH5" }).promotionCode, "LAUNCH5");
  // Still strict: an unknown field is refused.
  assert.equal(planSwitchPreviewQuerySchema.safeParse({ targetPlanSlug: "rates", coupon: "x" }).success, false);
});

test("the preview's promotion parses; absent stays absent", () => {
  const base = {
    previewId: "p", expiresAt: "2026-11-22T00:15:00Z", prorationDate: "2026-11-22T00:00:00Z", requiresConfirmation: false,
    subscriptions: [{ kind: "plan", lines: [], total: 2400 }], planChange: { from: "signature", to: "rates", fromInterval: "month", toInterval: "month" },
    chargeChange: { carriedCheckYourRateSeat: false, refiRadarDrops: false }, amountDueNow: 2400,
  };
  assert.equal("promotion" in planSwitchPreviewResponseSchema.parse(base), false);
  const promotion = { code: "LAUNCH5", discountAmount: 500, coupon: { name: "Launch", percentOff: null, amountOff: 500, currency: "usd", duration: "repeating", durationInMonths: 3 } };
  assert.deepEqual(planSwitchPreviewResponseSchema.parse({ ...base, promotion }).promotion, promotion);
});

test("the code refusals and the stale reason are listed and parse", () => {
  for (const c of ["code_not_found", "code_expired", "code_inactive", "code_used_up", "code_not_for_plan", "code_not_for_account", "code_not_applicable", "promotion_code_requires_preview"]) {
    assert.ok(PLAN_SWITCH_ERROR_CODES.includes(c), c);
    assert.equal(planSwitchErrorSchema.parse({ error: c, message: "m" }).error, c);
  }
  assert.ok(PREVIEW_STALE_REASONS.includes("promotion_code_changed"));
  assert.equal(previewStaleErrorSchema.parse({ error: "preview_stale", reason: "promotion_code_changed" }).reason, "promotion_code_changed");
});

test("previewPlanSwitch sends promotionCode in the query, trimmed; a blank one is not sent", async () => {
  const { createRelloClient } = await import("../dist/index.js");
  const calls = [];
  const body = { previewId: "p", expiresAt: "x", prorationDate: "x", requiresConfirmation: false, subscriptions: [], planChange: { from: "a", to: "b", fromInterval: "month", toInterval: "month" }, chargeChange: { carriedCheckYourRateSeat: false, refiRadarDrops: false } };
  const prev = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }); };
  try {
    const c = createRelloClient({ baseUrl: "https://test.invalid", apiKey: "k", appSlug: "pathfinder-pro" });
    await c.billing.previewPlanSwitch("t1", { targetPlanSlug: "rates", promotionCode: " Launch5 " });
    await c.billing.previewPlanSwitch("t1", { targetPlanSlug: "rates", promotionCode: "  " });
  } finally {
    globalThis.fetch = prev;
  }
  assert.equal(new URL(calls[0]).searchParams.get("promotionCode"), "Launch5");
  assert.equal(new URL(calls[1]).searchParams.has("promotionCode"), false);
});
