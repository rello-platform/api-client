import { test } from "node:test";
import assert from "node:assert/strict";
import * as api from "../dist/index.js";

// PFP Gateway X2b (SPEC-PFP-GATEWAY.md rev 10.30 D33; Platform KA prompt 1171,
// plan a4-1151 ruled): what Rello's team-member routes need beyond v2.33.0.
//  1. The sign-in-link resend carries a requestId, so a retried click is one email.
//  2. GET /api/provisioning/team-member's query schema (the logins read, with the
//     derived "over by N" the out-of-band ruling asks for).
//  3. The cannot_remove_owner refusal.

test("sign-in-link request: requestId is required, bounded, and the body stays strict", () => {
  const s = api.teamMemberSignInLinkRequestSchema;
  const ok = { tenantId: "t1", actingRelloUserId: "u1", requestId: " req-12345678 " };
  const r = s.safeParse(ok);
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.deepEqual(r.data, { tenantId: "t1", actingRelloUserId: "u1", requestId: "req-12345678" });
  assert.equal(s.safeParse({ tenantId: "t1", actingRelloUserId: "u1" }).success, false, "no requestId: a retry could send twice");
  assert.equal(s.safeParse({ ...ok, requestId: "short" }).success, false);
  assert.equal(s.safeParse({ ...ok, email: "x@example.com" }).success, false, "strict");
});

test("logins read query: tenantId and actingRelloUserId, trimmed, strict", () => {
  const s = api.teamLoginRosterQuerySchema;
  assert.ok(s, "teamLoginRosterQuerySchema missing");
  const r = s.safeParse({ tenantId: " t1 ", actingRelloUserId: "u1" });
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.deepEqual(r.data, { tenantId: "t1", actingRelloUserId: "u1" });
  assert.equal(s.safeParse({ tenantId: "t1" }).success, false);
  assert.equal(s.safeParse({ tenantId: "t1", actingRelloUserId: "u1", all: "1" }).success, false);
});

test("ROSTER_ERROR_CODES gains cannot_remove_owner and keeps every v2.33.0 code", () => {
  const v233 = [
    "invalid_body", "unauthorized", "key_not_scoped", "missing_permission", "unknown_app", "tenant_mismatch",
    "app_not_enabled", "actor_not_owner", "agent_not_found", "member_not_found", "signature_quantity_needed",
    "login_quantity_needed", "email_in_use", "already_member", "email_registered_elsewhere", "idempotency_key_reused",
    "internal_error",
  ];
  for (const c of v233) assert.ok(api.ROSTER_ERROR_CODES.includes(c), c);
  assert.ok(api.ROSTER_ERROR_CODES.includes("cannot_remove_owner"));
  assert.equal(api.ROSTER_ERROR_CODES.length, v233.length + 1);
});
