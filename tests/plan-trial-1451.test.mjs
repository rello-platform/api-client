import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../dist/index.js";

// Platform KA prompt 1451 (PFP Gateway Full PFP trial, G-10R-2t-A, ruling K11a); spec: Agent 5's
// build plan a5-1450 §(b). The wire schemas of the once-per-tenant plan trial:
//   planTrialStateSchema          { planSlug, startedAt, endsAt }
//   planTrialStartRequestSchema   { trialPlanSlug? } strict, 1-100 chars when sent (amendment 1454: optional)
//   planTrialStartResponseSchema  { trialId, trialPlanSlug, startedAt, endsAt, rev }
//   PLAN_TRIAL_START_ERROR_CODES  nine codes (amendment 1454 added trial_plan_unknown); planTrialStartErrorSchema { error, trial? } loose
//   `trial` (nullable, optional) on planGrantsReadResponseSchema and tenantPlanGrantsSchema
// Additive: an old body parses unchanged and an absent `trial` stays absent (never defaulted to null).

const START = "2026-11-19T22:30:00.000Z";
const END = "2026-12-03T22:30:00.000Z";
const STATE = { planSlug: "pfp-full", startedAt: START, endsAt: END };
const CODES = ["trial_already_used", "already_entitled", "not_gateway_tenant", "switch_in_progress", "switch_not_allowed", "unknown_trial_plan", "trial_plan_unknown", "invalid_body", "plan_trial_unavailable"];

test("trial state: planSlug + ISO startedAt/endsAt; empty slug, bad or missing dates refused; unknown keys dropped like its neighbours", () => {
  const s = api.planTrialStateSchema;
  assert.ok(s, "planTrialStateSchema missing");
  assert.deepEqual(s.safeParse(STATE).data, STATE);
  assert.equal(s.safeParse({ ...STATE, startedAt: "2026-11-19T15:30:00-07:00" }).success, true, "an offset is an ISO instant");
  assert.equal(s.safeParse({ ...STATE, planSlug: "" }).success, false);
  for (const k of ["planSlug", "startedAt", "endsAt"]) {
    const { [k]: _gone, ...rest } = STATE;
    assert.equal(s.safeParse(rest).success, false, `${k} is required`);
  }
  for (const bad of ["yesterday", "", "2026-11-19", 1763591400000, null]) {
    assert.equal(s.safeParse({ ...STATE, endsAt: bad }).success, false, `endsAt ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(s.safeParse({ ...STATE, later: 1 }).data, STATE, "an extra key is dropped, not a refusal");
});

test("start request: { trialPlanSlug? } strict; {} parses (the plan is pinned by grant); a slug sent is 1-100 characters", () => {
  const s = api.planTrialStartRequestSchema;
  assert.ok(s, "planTrialStartRequestSchema missing");
  assert.deepEqual(s.safeParse({ trialPlanSlug: "pfp-full" }).data, { trialPlanSlug: "pfp-full" });
  assert.equal(s.safeParse({ trialPlanSlug: "x".repeat(100) }).success, true, "100 is allowed");
  assert.equal(s.safeParse({ trialPlanSlug: "x".repeat(101) }).success, false, "101 is not");
  for (const bad of ["", 1, null, ["pfp-full"]]) assert.equal(s.safeParse({ trialPlanSlug: bad }).success, false, JSON.stringify(bad));
  const empty = s.safeParse({});
  assert.equal(empty.success, true, "an empty body parses: trialPlanSlug is optional (amendment 1454)");
  assert.deepEqual(empty.data, {}, "nothing is added to it");
  assert.equal("trialPlanSlug" in empty.data, false);
  assert.equal(s.safeParse({ trialPlanSlug: undefined }).success, true, "an explicit undefined is the same as absent");
  assert.equal(s.safeParse({ trialPlanSlug: "pfp-full", tenantId: "t" }).success, false, "strict: the tenant is the key's, never a body field");
});

test("start response: trialId, trialPlanSlug, startedAt, endsAt, integer rev >= 0", () => {
  const s = api.planTrialStartResponseSchema;
  assert.ok(s, "planTrialStartResponseSchema missing");
  const ok = { trialId: "trial_1", trialPlanSlug: "pfp-full", startedAt: START, endsAt: END, rev: 7 };
  assert.deepEqual(s.safeParse(ok).data, ok);
  assert.equal(s.safeParse({ ...ok, rev: 0 }).success, true, "zero is an integer >= 0");
  for (const bad of [-1, 1.5, "7", null, Number.MAX_SAFE_INTEGER + 2]) assert.equal(s.safeParse({ ...ok, rev: bad }).success, false, `rev ${JSON.stringify(bad)}`);
  for (const k of Object.keys(ok)) {
    const { [k]: _gone, ...rest } = ok;
    assert.equal(s.safeParse(rest).success, false, `${k} is required`);
  }
  assert.equal(s.safeParse({ ...ok, trialId: "" }).success, false);
  assert.equal(s.safeParse({ ...ok, trialPlanSlug: "" }).success, false);
  assert.equal(s.safeParse({ ...ok, endsAt: "soon" }).success, false);
});

test("error codes: exactly the nine, no duplicate; each parses; an unlisted code now parses too (1457); trial rides on a refusal with its status", () => {
  const codes = api.PLAN_TRIAL_START_ERROR_CODES;
  assert.ok(Array.isArray(codes), "PLAN_TRIAL_START_ERROR_CODES missing");
  assert.deepEqual([...codes].sort(), [...CODES].sort());
  assert.ok(codes.includes("trial_plan_unknown") && codes.includes("unknown_trial_plan"), "both the 409 and the 400 code are kept (they are two different answers)");
  assert.equal(codes.length, 9);
  assert.equal(new Set(codes).size, codes.length);
  const e = api.planTrialStartErrorSchema;
  assert.ok(e, "planTrialStartErrorSchema missing");
  for (const error of codes) assert.equal(e.safeParse({ error }).success, true, error);
  assert.equal(e.safeParse({ error: "some_later_code" }).success, true, "1457: error is an open string like its siblings, so a code Rello adds later still parses (v2.43.0 refused it)");
  assert.equal(e.safeParse({}).success, false);
  assert.equal(e.safeParse({ error: 3 }).success, false);
  const used = e.safeParse({ error: "trial_already_used", trial: { ...STATE, status: "ENDED" } });
  assert.equal(used.success, true, JSON.stringify(used.error?.issues));
  assert.deepEqual(used.data.trial, { ...STATE, status: "ENDED" });
  assert.equal(e.safeParse({ error: "trial_already_used", trial: STATE }).success, false, "a trial on a refusal carries its status");
  assert.equal(e.safeParse({ error: "trial_already_used", trial: { ...STATE, status: "ENDED", endsAt: "soon" } }).success, false);
  assert.equal(e.safeParse({ error: "already_entitled", message: "m", extra: 1 }).data.extra, 1, "loose: extra keys are kept");
  assert.equal("trial" in e.safeParse({ error: "invalid_body" }).data, false, "trial absent stays absent");
});

test("plan-grants read: an old body (no trial) parses unchanged and trial stays absent; null and a state are kept; a broken trial refuses the body", () => {
  const s = api.planGrantsReadResponseSchema;
  const base = { rev: 4, grants: ["pfp-core"], planSlug: "pfp-starter", cyr: null };
  const old = s.safeParse(base);
  assert.equal(old.success, true, JSON.stringify(old.error?.issues));
  assert.deepEqual(old.data, base, "nothing is added");
  assert.equal("trial" in old.data, false, "absent is never defaulted to null");
  assert.equal(s.safeParse({ ...base, trial: null }).data.trial, null);
  assert.deepEqual(s.safeParse({ ...base, trial: STATE }).data.trial, STATE);
  assert.equal(s.safeParse({ ...base, trial: { ...STATE, endsAt: "soon" } }).success, false);
  assert.equal(s.safeParse({ ...base, trial: { planSlug: "pfp-full" } }).success, false);
  assert.equal(s.safeParse({ rev: 4, grants: [], planSlug: "pfp-starter" }).success, false, "cyr stays required (A-286)");
});

test("tenant plan grants (the plan_grants_changed data): same three cases, and the old shape parses unchanged", () => {
  const s = api.tenantPlanGrantsSchema;
  const base = { rev: 9, grants: ["pfp-core"], planSlug: "pfp-starter" };
  const old = s.safeParse(base);
  assert.equal(old.success, true);
  assert.deepEqual(old.data, base);
  assert.equal("trial" in old.data, false, "absent is never defaulted to null");
  assert.deepEqual(s.safeParse({ ...base, cause: "plan_change" }).data, { ...base, cause: "plan_change" }, "cause is untouched");
  assert.equal(s.safeParse({ ...base, planSlug: null }).success, true, "a cancelled tenant's null planSlug is untouched");
  assert.equal(s.safeParse({ ...base, trial: null }).data.trial, null);
  assert.deepEqual(s.safeParse({ ...base, trial: STATE }).data.trial, STATE);
  assert.equal(s.safeParse({ ...base, trial: { ...STATE, startedAt: 5 } }).success, false);
});

test("the package root exports every new name, values and types (the d.ts export list too)", () => {
  for (const name of ["planTrialStateSchema", "planTrialStartRequestSchema", "planTrialStartResponseSchema", "planTrialStartErrorSchema", "PLAN_TRIAL_START_ERROR_CODES"]) {
    assert.ok(name in api, `${name} missing from the package root`);
  }
  const dts = readFileSync(new URL("../dist/index.d.ts", import.meta.url), "utf8");
  const exportLine = dts.split("\n").filter((l) => l.startsWith("export {")).join(" ");
  for (const name of ["PlanTrialState", "PlanTrialStartRequest", "PlanTrialStartResponse", "PlanTrialStartErrorCode", "PlanTrialStartError"]) {
    assert.match(exportLine, new RegExp(`\\b${name}\\b`), `type ${name} missing from the d.ts export list`);
  }
});
