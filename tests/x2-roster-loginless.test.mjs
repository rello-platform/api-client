import { test } from "node:test";
import assert from "node:assert/strict";
import * as api from "../dist/index.js";

// PFP Gateway X2 (SPEC-PFP-GATEWAY.md rev 10.30 §6 [D30], G-EXTRAS, D33;
// Platform KA prompts 1152/1153/1155, plan a4-1151 ruled).
//  1. provisionedAgentSchema gains `loginless` (OPTIONAL boolean). The schema is a
//     plain z.object, which strips unknown keys, and Rello sends the PARSED
//     tenant-enable payload, so at v2.32.0 the flag never reached the wire.
//     Rello always sends it, true or false; a receiver reads absent as unknown.
//  2. The X2 roster routes' request schemas, answers and refusal codes, so Rello's
//     routes and PathfinderPro's callers share one contract.

const { tenantEnablePayloadSchema } = api;

const agent = (over = {}) => ({
  relloAgentId: "a1", email: "a1@example.com", firstName: "A", lastName: "One",
  slug: "a-one", role: "MLO", phone: null, ...over,
});
const payload = (agents) => ({
  action: "enable", relloTenantId: "tenant_1",
  tenant: { name: "Acme", slug: "acme", logoUrl: null, primaryColor: null, physicalAddress: null, applicationUrl: null, type: "MLO", plan: "pathfinder-team" },
  agents,
});

test("tenant-enable: loginless true and false survive the parse; absent stays absent", () => {
  const r = tenantEnablePayloadSchema.safeParse(payload([agent({ loginless: true }), agent({ relloAgentId: "a2", loginless: false }), agent({ relloAgentId: "a3" })]));
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.equal(r.data.agents[0].loginless, true);
  assert.equal(r.data.agents[1].loginless, false);
  assert.equal("loginless" in r.data.agents[2], false);
  assert.equal(tenantEnablePayloadSchema.safeParse(payload([agent({ loginless: "yes" })])).success, false);
});

test("loginless-agent create request: strict, trimmed, email lower-cased, requestId bounded", () => {
  const s = api.loginlessAgentCreateRequestSchema;
  assert.ok(s, "loginlessAgentCreateRequestSchema missing");
  const ok = { tenantId: " t1 ", actingRelloUserId: "u1", firstName: " Eli ", lastName: "Extra", email: " Eli@Example.COM ", requestId: "req-12345678" };
  const r = s.safeParse(ok);
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.deepEqual(r.data, { tenantId: "t1", actingRelloUserId: "u1", firstName: "Eli", lastName: "Extra", email: "eli@example.com", requestId: "req-12345678" });
  assert.equal(s.safeParse({ ...ok, nmlsNumber: "1" }).success, false, "unknown key refused (identity is Home Scout's)");
  assert.equal(s.safeParse({ ...ok, userId: "u9" }).success, false, "a userId is never accepted");
  assert.equal(s.safeParse({ ...ok, requestId: "short" }).success, false);
  assert.equal(s.safeParse({ ...ok, email: "not-an-email" }).success, false);
  assert.equal(s.safeParse({ ...ok, firstName: "   " }).success, false);
});

test("loginless-agent remove and team-member requests are strict", () => {
  assert.equal(api.loginlessAgentRemoveRequestSchema.safeParse({ tenantId: "t1", actingRelloUserId: "u1" }).success, true);
  assert.equal(api.loginlessAgentRemoveRequestSchema.safeParse({ tenantId: "t1", actingRelloUserId: "u1", hard: true }).success, false);
  const tm = { tenantId: "t1", actingRelloUserId: "u1", email: "New@Example.com", firstName: "N", lastName: "M", requestId: "req-abcdefgh" };
  const r = api.teamMemberCreateRequestSchema.safeParse(tm);
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.equal(r.data.email, "new@example.com");
  assert.equal(api.teamMemberCreateRequestSchema.safeParse({ ...tm, role: "PLATFORM_ADMIN" }).success, false);
  assert.equal(api.teamMemberRemoveRequestSchema.safeParse({ tenantId: "t1", actingRelloUserId: "u1" }).success, true);
  // v2.35.0: the resend carries a requestId (x2b-team-roster-read.test.mjs).
  assert.equal(api.teamMemberSignInLinkRequestSchema.safeParse({ tenantId: "t1", actingRelloUserId: "u1", requestId: "req-abcdefgh" }).success, true);
});

test("the refusal codes are one closed list, including both quantity codes", () => {
  const codes = [...api.ROSTER_ERROR_CODES];
  for (const c of ["signature_quantity_needed", "login_quantity_needed", "actor_not_owner", "idempotency_key_reused", "email_in_use", "already_member", "email_registered_elsewhere", "agent_not_found", "tenant_mismatch", "app_not_enabled", "missing_permission"]) {
    assert.ok(codes.includes(c), `missing ${c}`);
  }
  assert.equal(new Set(codes).size, codes.length);
});
