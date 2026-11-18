import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../dist/index.js";

// PFP Gateway P-1 (Platform KA prompt 1221; PFP O-6): zod for the answers
// v2.36.0 shipped as types only (roster, plan switch), plus the plan-grants read.
//
// Roster fixtures are Rello's REAL served bodies, captured from Rello main
// @c4fceb59e's roster pg-tests (tests/fixtures/rello-roster-served-c4fceb59e.json
// says how). Plan-switch fixtures are HAND-WRITTEN from the contract: no Rello
// route serves plan-switch yet (G-10R builds it to this contract).

const served = JSON.parse(readFileSync(new URL("./fixtures/rello-roster-served-c4fceb59e.json", import.meta.url), "utf8")).answers;
const ok = (schema, body, label) => {
  const r = schema.safeParse(body);
  assert.equal(r.success, true, `${label}: ${JSON.stringify(r.error?.issues)}`);
  return r.data;
};
const bad = (schema, body, label) => assert.equal(schema.safeParse(body).success, false, label);

// ─── Roster answers, against Rello's served bodies ───────────────────────────

test("roster: every success body Rello serves parses with its schema, and a broken one does not", () => {
  const cases = [
    ["loginlessAgentCreate:201", api.loginlessAgentCreateResponseSchema, "relloAgentId"],
    ["loginlessAgentCreate:200", api.loginlessAgentCreateResponseSchema, "replayed"],
    ["loginlessAgentRemove:200", api.loginlessAgentRemoveResponseSchema, "status"],
    ["teamMemberCreate:201", api.teamMemberCreateResponseSchema, "signInEmail"],
    ["teamMemberCreate:200", api.teamMemberCreateResponseSchema, "userId"],
    ["teamMemberSignInLink:202", api.teamMemberSignInLinkResponseSchema, "signInEmail"],
    ["teamMemberSignInLink:200", api.teamMemberSignInLinkResponseSchema, "replayed"],
    ["teamMemberRemove:200", api.teamMemberRemoveResponseSchema, "isActive"],
    ["teamLoginRoster:200", api.teamLoginRosterResponseSchema, "overBy"],
  ];
  for (const [name, schema, field] of cases) {
    assert.ok(schema, `${name}: schema missing`);
    const body = served[name]?.body;
    assert.ok(body, `${name}: no served fixture`);
    ok(schema, body, name);
    const broken = { ...body };
    delete broken[field];
    bad(schema, broken, `${name} without ${field}`);
  }
});

test("roster read: people parse; included and capacity are null together; counts are non-negative integers", () => {
  const body = served["teamLoginRoster:200"].body;
  assert.ok(body.people.length >= 1, "the fixture lists people");
  const data = ok(api.teamLoginRosterResponseSchema, body, "served roster read");
  assert.equal(data.people[0].relloAgentId, body.people[0].relloAgentId);
  ok(api.teamLoginRosterResponseSchema, { ...body, included: null, capacity: null }, "no plan limit");
  bad(api.teamLoginRosterResponseSchema, { ...body, included: null }, "included null, capacity set");
  bad(api.teamLoginRosterResponseSchema, { ...body, overBy: -1 }, "negative overBy");
  bad(api.teamLoginRosterResponseSchema, { ...body, members: 1.5 }, "fractional members");
  bad(api.teamLoginRosterResponseSchema, { ...body, addOnCatalogKey: "pfp-extra-signature" }, "wrong catalog key");
});

test("roster refusals: every served refusal parses as RosterError, keeps its extra fields, and its code is known", () => {
  const refusals = Object.entries(served).filter(([k]) => k.startsWith("error:"));
  assert.ok(refusals.length >= 17, `served refusals: ${refusals.length}`);
  for (const [name, { body }] of refusals) {
    const data = ok(api.rosterErrorSchema, body, name);
    assert.deepEqual(data, body, `${name}: nothing dropped`);
    assert.equal(api.isRosterErrorCode(body.code), true, `${name}: ${body.code} is in ROSTER_ERROR_CODES`);
  }
  // A code a later Rello adds is still an answer, not a parse failure.
  ok(api.rosterErrorSchema, { code: "some_future_code", error: "x" }, "future code");
  assert.equal(api.isRosterErrorCode("some_future_code"), false);
  bad(api.rosterErrorSchema, { error: "no code" }, "no code");
  bad(api.rosterErrorSchema, { code: "invalid_body" }, "no error text");
});

test("roster: the three exact refusals parse their own schema from Rello's bodies, and only theirs", () => {
  const exact = [
    ["error:signature_quantity_needed:addOnCatalogKey+extras+purchased", api.signatureQuantityNeededSchema, "extras"],
    ["error:login_quantity_needed:addOnCatalogKey+included+members+purchased", api.loginQuantityNeededSchema, "members"],
    ["error:already_member:isActive+userId", api.alreadyMemberSchema, "userId"],
  ];
  for (const [name, schema, field] of exact) {
    const body = served[name]?.body;
    assert.ok(body, `${name}: no served fixture`);
    ok(schema, body, name);
    const broken = { ...body };
    delete broken[field];
    bad(schema, broken, `${name} without ${field}`);
    bad(schema, served["error:invalid_body:plain"].body, `${name} schema refuses invalid_body`);
  }
});

// ─── Plan switch (HAND-WRITTEN fixtures from the contract) ───────────────────

const HAND_WRITTEN_PREVIEW = {
  previewId: "psp_hand_1",
  expiresAt: "2026-11-17T12:15:00.000Z",
  prorationDate: "2026-11-17T12:00:00.000Z",
  requiresConfirmation: true,
  subscriptions: [
    {
      kind: "plan",
      lines: [
        { description: "Unused time on Pro", amount: -5000, currency: "usd", period: { start: "2026-11-17T12:00:00.000Z", end: "2026-12-01T00:00:00.000Z" }, proration: true },
        { description: "Starter", amount: 2900, currency: "usd", period: { start: "2026-11-17T12:00:00.000Z", end: "2026-12-01T00:00:00.000Z" }, proration: true },
      ],
      total: -2100,
    },
  ],
  planChange: { from: "pfp-pro", to: "pfp-starter", fromInterval: "month", toInterval: "month" },
  chargeChange: { carriedCheckYourRateSeat: true, refiRadarDrops: false },
};

test("plan switch (hand-written fixtures): preview, applied, open and operation answers parse; broken ones do not", () => {
  ok(api.planSwitchPreviewResponseSchema, HAND_WRITTEN_PREVIEW, "preview");
  bad(api.planSwitchPreviewResponseSchema, { ...HAND_WRITTEN_PREVIEW, previewId: "" }, "empty previewId");
  bad(api.planSwitchPreviewResponseSchema, { ...HAND_WRITTEN_PREVIEW, planChange: { ...HAND_WRITTEN_PREVIEW.planChange, toInterval: "week" } }, "bad interval");
  bad(api.planSwitchPreviewResponseSchema, { ...HAND_WRITTEN_PREVIEW, subscriptions: [{ ...HAND_WRITTEN_PREVIEW.subscriptions[0], total: 1.5 }] }, "fractional minor amount");

  const applied = { operationId: "op_1", status: "APPLIED", steps: [{ index: 0, kind: "plan_item", state: "DONE" }], planSlug: "pfp-starter", interval: "month", invoiceIds: ["in_1"] };
  const open = { operationId: "op_1", status: "OPEN" };
  assert.equal(ok(api.planSwitchResponseSchema, applied, "applied").status, "APPLIED");
  assert.equal(ok(api.planSwitchResponseSchema, open, "open").status, "OPEN");
  bad(api.planSwitchResponseSchema, { ...open, status: "FAILED" }, "a POST never answers FAILED");
  bad(api.planSwitchResponseSchema, { operationId: "op_1", status: "APPLIED" }, "applied without steps");

  const operation = { operationId: "op_1", status: "COMPENSATED", steps: [], previewId: null, invoiceIds: [], resolutionNeeded: true, unknownSince: "2026-11-17T12:01:00.000Z" };
  ok(api.planSwitchOperationResponseSchema, operation, "operation");
  bad(api.planSwitchOperationResponseSchema, { ...operation, resolutionNeeded: undefined }, "operation without resolutionNeeded");
  bad(api.planSwitchOperationResponseSchema, { ...operation, steps: [{ index: 0, kind: "x", state: "WAITING" }] }, "unknown step state");
});

test("plan switch: 409 members_exceed_target carries exactly { activeMembers, targetLimit } as non-negative integers", () => {
  const s = api.membersExceedTargetErrorSchema;
  assert.ok(s, "membersExceedTargetErrorSchema missing");
  const body = { error: "members_exceed_target", activeMembers: 7, targetLimit: 5 };
  ok(s, body, "exact");
  ok(s, { ...body, message: "7 people have a login; Starter allows 5." }, "with a message");
  bad(s, { ...body, quantity: 5 }, "an extra field (exact object)");
  bad(s, { error: "members_exceed_target", activeMembers: 7 }, "no targetLimit");
  bad(s, { ...body, targetLimit: -1 }, "negative targetLimit");
  bad(s, { ...body, activeMembers: 2.5 }, "fractional activeMembers");
  bad(s, { ...body, activeMembers: "7" }, "a string count");
  bad(s, { ...body, error: "members_exceed_quantity" }, "the X1 code");
  assert.equal(api.isMembersExceedTargetError(body), true);
  assert.equal(api.isMembersExceedTargetError({ error: "members_exceed_target" }), false);
  assert.ok(api.PLAN_SWITCH_ERROR_CODES.includes("members_exceed_target"));
});

test("plan switch: every refusal parses with planSwitchErrorSchema; the exact branches keep their fields", () => {
  const exceed = { error: "members_exceed_target", activeMembers: 7, targetLimit: 5 };
  assert.deepEqual(ok(api.planSwitchErrorSchema, exceed, "exceed"), exceed);
  assert.deepEqual(ok(api.planSwitchErrorSchema, { error: "switch_in_progress", operationId: "op_9" }, "in progress"), { error: "switch_in_progress", operationId: "op_9" });
  ok(api.switchInProgressErrorSchema, { error: "switch_in_progress", operationId: "op_9" }, "in progress exact");
  bad(api.switchInProgressErrorSchema, { error: "switch_in_progress" }, "in progress without operationId");
  ok(api.planSwitchErrorSchema, { error: "preview_stale", reason: "inputs_changed" }, "stale");
  // Each code with the fields its own schema requires (GD-2146: a dedicated code
  // parses only through its own schema, so members_exceed_target needs its counts).
  const required = { switch_in_progress: { operationId: "op" }, members_exceed_target: { activeMembers: 7, targetLimit: 5 } };
  for (const code of api.PLAN_SWITCH_ERROR_CODES) ok(api.planSwitchErrorSchema, { error: code, message: "m", ...(required[code] ?? {}) }, code);
  bad(api.planSwitchErrorSchema, { error: "members_exceed_target", message: "m" }, "members_exceed_target without its counts");
  ok(api.planSwitchErrorSchema, { error: "a_future_code" }, "a code Rello adds later is still an answer");
  bad(api.planSwitchErrorSchema, { message: "no error" }, "no error field");
});

// ─── Plan-grants read ────────────────────────────────────────────────────────

const CYR = {
  featureSlug: "check-your-rate",
  status: "ACTIVE",
  quantity: 1,
  trialEndsAt: null,
  canceledAt: null,
  occurredAt: "2026-11-17T12:00:00.123Z",
  seq: 4,
  source: "plan",
};

test("plan-grants read: cyr is a REQUIRED nullable key; rev is a safe non-negative integer", () => {
  const s = api.planGrantsReadResponseSchema;
  assert.ok(s, "planGrantsReadResponseSchema missing");
  const base = { rev: 4294967301, grants: ["pfp-full", "check-your-rate"], planSlug: "pfp-pro" };
  ok(s, { ...base, cyr: CYR }, "with cyr");
  assert.equal(ok(s, { ...base, cyr: null }, "never held").cyr, null);
  bad(s, base, "no cyr key: an incomplete answer, never 'never held' (A-286)");
  bad(s, { ...base, cyr: undefined }, "cyr undefined");
  bad(s, { ...base, rev: Number.MAX_SAFE_INTEGER + 2, cyr: null }, "rev past the safe range");
  bad(s, { ...base, rev: -1, cyr: null }, "negative rev");
  bad(s, { ...base, rev: "4294967301", cyr: null }, "rev as a string");
  bad(s, { ...base, planSlug: null, cyr: null }, "Rello answers 503 for a null planSlug, never a 200");
  bad(s, { ...base, cyr: { ...CYR, status: "none" } }, "cyr status outside the four");
  bad(s, { ...base, cyr: { ...CYR, seq: undefined } }, "cyr without seq");
});

test("plan-grants read: the refusal codes and the tenant-match 403 texts", () => {
  ok(api.planGrantsReadErrorSchema, { error: "no_plan_grants" }, "404");
  ok(api.planGrantsReadErrorSchema, { error: "plan_grants_unavailable" }, "503");
  bad(api.planGrantsReadErrorSchema, { error: "Forbidden" }, "a 403 is not a read refusal");
  assert.deepEqual([...api.PLAN_GRANTS_READ_ERROR_CODES], ["no_plan_grants", "plan_grants_unavailable"]);
  assert.equal(api.V1_TENANT_MATCH_ERRORS.tenantHeaderMismatch, "Forbidden — tenant header does not match credential");
  assert.equal(api.V1_TENANT_MATCH_ERRORS.callerAppNotAllowed, "Forbidden — caller app not allowed");
  assert.equal(api.appNotEnabledForTenantError("pathfinder-pro"), "Forbidden — app 'pathfinder-pro' is not enabled for tenant");
});
