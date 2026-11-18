import { test } from "node:test";
import assert from "node:assert/strict";
import * as api from "../dist/index.js";

// AUDIT 111 GD-2146 (KA 1275): the plan-switch error family's open branch
// accepted malformed bodies for codes that have their own schema. A known code
// must parse only through its own schema; an unknown code still parses.

// The auditor's five bodies (evidence/audit111-1271-261117-1942Z/api-client--audit111-schema-probes.mjs).
const AUDITOR_MALFORMED = [
  { error: "members_exceed_target" },
  { error: "members_exceed_target", activeMembers: -1, targetLimit: "five" },
  { error: "members_exceed_target", activeMembers: 7, targetLimit: 5, quantity: 5 },
  { error: "switch_in_progress" },
  { error: "preview_stale", reason: 42 },
];

test("GD-2146: each of the auditor's five malformed known bodies is refused by planSwitchErrorSchema", () => {
  for (const body of AUDITOR_MALFORMED) {
    assert.equal(api.planSwitchErrorSchema.safeParse(body).success, false, `accepted ${JSON.stringify(body)}`);
  }
});

test("GD-2146: the open branch alone refuses every dedicated code, and the list names exactly the three", () => {
  assert.deepEqual([...api.PLAN_SWITCH_DEDICATED_ERROR_CODES].sort(), ["members_exceed_target", "preview_stale", "switch_in_progress"]);
  for (const error of api.PLAN_SWITCH_DEDICATED_ERROR_CODES) {
    assert.equal(api.planSwitchOtherErrorSchema.safeParse({ error }).success, false, error);
  }
});

test("GD-2146: well-formed dedicated bodies still parse, through their own schema", () => {
  const good = [
    [{ error: "members_exceed_target", activeMembers: 7, targetLimit: 5 }, api.membersExceedTargetErrorSchema],
    [{ error: "members_exceed_target", activeMembers: 0, targetLimit: 0, message: "Too many logins" }, api.membersExceedTargetErrorSchema],
    [{ error: "switch_in_progress", operationId: "op_1" }, api.switchInProgressErrorSchema],
    [{ error: "preview_stale", reason: "expired" }, api.previewStaleErrorSchema],
    [{ error: "preview_stale" }, api.previewStaleErrorSchema],
  ];
  for (const [body, own] of good) {
    assert.equal(api.planSwitchErrorSchema.safeParse(body).success, true, JSON.stringify(body));
    assert.equal(own.safeParse(body).success, true, JSON.stringify(body));
  }
});

test("GD-2146: a known code with no dedicated schema, and an unknown future code, still parse through the open branch", () => {
  const nonDedicated = api.PLAN_SWITCH_ERROR_CODES.filter((c) => !api.PLAN_SWITCH_DEDICATED_ERROR_CODES.includes(c));
  assert.ok(nonDedicated.length >= 10, `expected the other codes, got ${nonDedicated.length}`);
  for (const error of nonDedicated) {
    const r = api.planSwitchErrorSchema.safeParse({ error, message: "refused" });
    assert.equal(r.success, true, error);
  }
  const future = api.planSwitchErrorSchema.safeParse({ error: "some_code_rello_adds_later", message: "x", extra: 1 });
  assert.equal(future.success, true);
  assert.equal(future.data.extra, 1, "extra fields are kept");
});
