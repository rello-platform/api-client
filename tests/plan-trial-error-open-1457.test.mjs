import { test } from "node:test";
import assert from "node:assert/strict";
import * as api from "../dist/index.js";

// Platform KA prompt 1457 (PFP Gateway: one api-client version, the plan-trial error code as an open
// string). v2.43.0 made planTrialStartErrorSchema's `error` a z.enum of the 9 known codes, so a code
// Rello adds later did not parse and PathfinderPro could not read that refusal at all. Its siblings
// (addOnChargeOnceErrorSchema, planSwitchErrorSchema's open branch) take any non-empty string.
// KA ruling: make it match them. PLAN_TRIAL_START_ERROR_CODES stays the nine known codes;
// `trial?` and .loose() are unchanged; every body that parsed in v2.43.0 parses identically.

const START = "2026-11-19T22:30:00.000Z";
const END = "2026-12-03T22:30:00.000Z";
const STATE = { planSlug: "pfp-full", startedAt: START, endsAt: END };
const CODES = ["trial_already_used", "already_entitled", "not_gateway_tenant", "switch_in_progress", "switch_not_allowed", "unknown_trial_plan", "trial_plan_unknown", "invalid_body", "plan_trial_unavailable"];
const e = api.planTrialStartErrorSchema;

test("an unlisted code parses: a code Rello adds later is still a readable refusal", () => {
  assert.ok(e, "planTrialStartErrorSchema missing");
  for (const error of ["plan_trial_new_reason", "some_later_code", "X"]) {
    const r = e.safeParse({ error });
    assert.equal(r.success, true, `${error}: ${JSON.stringify(r.error?.issues)}`);
    assert.equal(r.data.error, error, "the code comes back as sent");
  }
  const withExtras = e.safeParse({ error: "plan_trial_new_reason", message: "m", retryAfter: 5 });
  assert.equal(withExtras.success, true);
  assert.deepEqual(withExtras.data, { error: "plan_trial_new_reason", message: "m", retryAfter: 5 }, "loose: extras kept on an unlisted code");
  const withTrial = e.safeParse({ error: "plan_trial_new_reason", trial: { ...STATE, status: "ENDED" } });
  assert.equal(withTrial.success, true, "trial is accepted on any code");
  assert.deepEqual(withTrial.data.trial, { ...STATE, status: "ENDED" });
});

test("still refused: no error, an empty or non-string error, a broken trial; trial still needs its status", () => {
  assert.equal(e.safeParse({}).success, false, "error is required");
  assert.equal(e.safeParse({ error: "" }).success, false, "an empty code is not an answer");
  for (const error of [3, null, undefined, true, {}, ["a"]]) assert.equal(e.safeParse({ error }).success, false, `error ${JSON.stringify(error)}`);
  assert.equal(e.safeParse({ error: "plan_trial_new_reason", trial: STATE }).success, false, "a trial on a refusal carries its status, on an unlisted code too");
  assert.equal(e.safeParse({ error: "trial_already_used", trial: { ...STATE, status: "ENDED", endsAt: "soon" } }).success, false);
  assert.equal(e.safeParse("trial_already_used").success, false);
  assert.equal(e.safeParse(null).success, false);
});

test("every body that parsed in v2.43.0 parses identically: the nine known codes, trial present or absent, extras kept", () => {
  const codes = api.PLAN_TRIAL_START_ERROR_CODES;
  assert.deepEqual([...codes], CODES, "PLAN_TRIAL_START_ERROR_CODES is unchanged: the nine, in order");
  assert.equal(Object.isFrozen(codes) || Array.isArray(codes), true);
  for (const error of codes) {
    const r = e.safeParse({ error });
    assert.equal(r.success, true, error);
    assert.deepEqual(r.data, { error });
    assert.equal("trial" in r.data, false, "trial absent stays absent");
  }
  const used = e.safeParse({ error: "trial_already_used", trial: { ...STATE, status: "ENDED" }, message: "m" });
  assert.deepEqual(used.data, { error: "trial_already_used", trial: { ...STATE, status: "ENDED" }, message: "m" });
  assert.equal(e.safeParse({ error: "already_entitled", message: "m", extra: 1 }).data.extra, 1);
});
