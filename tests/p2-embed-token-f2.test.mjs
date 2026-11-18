import { test } from "node:test";
import assert from "node:assert/strict";
import * as api from "../dist/index.js";

// PFP Gateway P-2 (map MAP-P2-EMBED-TOKEN-F2-261118.md; Platform KA prompt 1306):
//  1. PathfinderPro → Rello POST /api/v1/embed-tokens mints a short-lived opaque
//     `rpe_` token so a Home Scout page can open inside PFP;
//  2. Home Scout → Rello POST /api/v1/embed-tokens/verify checks it;
//  3. F2: Home Scout → Rello GET /api/v1/platform/tenant-app-access asks whether
//     PFP may act for a tenant.

const ISO = "2026-11-18T17:05:00.000Z";

const mintResponse = (over = {}) => ({
  token: "rpe_9f2c4b1e7a",
  expiresAt: ISO,
  audience: "home-scout",
  scope: "hs:identity-editor",
  tenantId: "t1",
  agentId: "a1",
  ...over,
});

test("mint request: agentId and surface identity|rate-widget, strict", () => {
  const s = api.embedTokenMintRequestSchema;
  assert.ok(s, "embedTokenMintRequestSchema missing");
  for (const surface of ["identity", "rate-widget"]) {
    const r = s.safeParse({ agentId: "a1", surface });
    assert.equal(r.success, true, JSON.stringify(r.error?.issues));
    assert.deepEqual(r.data, { agentId: "a1", surface });
  }
  assert.equal(s.safeParse({ agentId: "a1", surface: "identity", tenantId: "t1" }).success, false, "strict: the tenant comes from the key");
  assert.equal(s.safeParse({ agentId: "a1", surface: "profile" }).success, false, "surface is identity | rate-widget");
  assert.equal(s.safeParse({ agentId: "", surface: "identity" }).success, false, "agentId non-empty");
  assert.equal(s.safeParse({ surface: "identity" }).success, false, "agentId required");
});

test("mint response: rpe_ token, ISO expiresAt, audience home-scout, scope hs:*, strict", () => {
  const s = api.embedTokenMintResponseSchema;
  assert.ok(s, "embedTokenMintResponseSchema missing");
  const r = s.safeParse(mintResponse());
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.deepEqual(r.data, mintResponse());
  assert.equal(s.safeParse(mintResponse({ scope: "hs:rate-widget" })).success, true);
  assert.equal(s.safeParse(mintResponse({ expiresAt: "2026-11-18T10:05:00-07:00" })).success, true, "an offset is ISO too");
  assert.equal(s.safeParse({ ...mintResponse(), surface: "identity" }).success, false, "strict");
  assert.equal(s.safeParse(mintResponse({ scope: "hs:admin" })).success, false, "scope enum");
  assert.equal(s.safeParse(mintResponse({ audience: "pathfinder-pro" })).success, false, "audience is home-scout");
  assert.equal(s.safeParse(mintResponse({ token: "tok_9f2c4b1e7a" })).success, false, "token must start with rpe_");
  assert.equal(s.safeParse(mintResponse({ token: "RPE_9f2c4b1e7a" })).success, false, "the prefix is lowercase");
  assert.equal(s.safeParse(mintResponse({ token: "rpe_" })).success, false, "a bare prefix is not a token");
  assert.equal(s.safeParse(mintResponse({ expiresAt: "tomorrow" })).success, false, "expiresAt is ISO-8601");
  assert.equal(s.safeParse(mintResponse({ tenantId: "" })).success, false);
  assert.equal(s.safeParse(mintResponse({ agentId: "" })).success, false);
});

test("EMBED_SURFACE_SCOPE maps identity → hs:identity-editor and rate-widget → hs:rate-widget", () => {
  const m = api.EMBED_SURFACE_SCOPE;
  assert.ok(m, "EMBED_SURFACE_SCOPE missing");
  assert.deepEqual({ ...m }, { identity: "hs:identity-editor", "rate-widget": "hs:rate-widget" });
  assert.ok(Object.isFrozen(m), "a shared map nobody can rewrite at runtime");
  for (const [surface, scope] of Object.entries(m)) {
    assert.equal(api.embedTokenMintRequestSchema.safeParse({ agentId: "a1", surface }).success, true, surface);
    assert.equal(api.embedTokenMintResponseSchema.safeParse(mintResponse({ scope })).success, true, scope);
  }
});

test("verify request: token non-empty, strict", () => {
  const s = api.embedTokenVerifyRequestSchema;
  assert.ok(s, "embedTokenVerifyRequestSchema missing");
  const r = s.safeParse({ token: "rpe_9f2c4b1e7a" });
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.deepEqual(r.data, { token: "rpe_9f2c4b1e7a" });
  assert.equal(s.safeParse({ token: "rpe_9f2c4b1e7a", tenantId: "t1" }).success, false, "strict");
  assert.equal(s.safeParse({ token: "" }).success, false, "token non-empty");
  assert.equal(s.safeParse({ token: 42 }).success, false, "token is a string");
  assert.equal(s.safeParse({}).success, false, "token required");
});

test("verify response valid:true: tenantId, agentId, scope, expiresAt; strict", () => {
  const s = api.embedTokenVerifyResponseSchema;
  assert.ok(s, "embedTokenVerifyResponseSchema missing");
  const ok = { valid: true, tenantId: "t1", agentId: "a1", scope: "hs:rate-widget", expiresAt: ISO };
  const r = s.safeParse(ok);
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.deepEqual(r.data, ok);
  assert.equal(s.safeParse({ valid: true }).success, false, "valid:true with nothing else is not a verdict");
  const { tenantId: _omit, ...noTenant } = ok;
  assert.equal(s.safeParse(noTenant).success, false, "valid:true needs tenantId");
  assert.equal(s.safeParse({ ...ok, reason: "expired" }).success, false, "strict: no reason on valid:true");
  assert.equal(s.safeParse({ ...ok, scope: "hs:admin" }).success, false, "scope enum");
  assert.equal(s.safeParse({ ...ok, expiresAt: "soon" }).success, false, "expiresAt is ISO-8601");
  assert.equal(s.safeParse({ ...ok, valid: "true" }).success, false, "valid is a boolean, not a string");
});

test("verify response valid:false: reason expired|revoked|unknown_token; strict", () => {
  const s = api.embedTokenVerifyResponseSchema;
  for (const reason of ["expired", "revoked", "unknown_token"]) {
    const r = s.safeParse({ valid: false, reason });
    assert.equal(r.success, true, `${reason}: ${JSON.stringify(r.error?.issues)}`);
    assert.deepEqual(r.data, { valid: false, reason });
  }
  assert.deepEqual([...api.EMBED_TOKEN_INVALID_REASONS].sort(), ["expired", "revoked", "unknown_token"]);
  assert.equal(s.safeParse({ valid: false, reason: "other" }).success, false, "reason enum");
  assert.equal(s.safeParse({ valid: false }).success, false, "valid:false carries a reason");
  assert.equal(s.safeParse({ valid: false, reason: "expired", tenantId: "t1" }).success, false, "strict: an invalid token names no tenant");
});

test("tenant-app-access response: tenantId and servable boolean, strict", () => {
  const s = api.tenantAppAccessResponseSchema;
  assert.ok(s, "tenantAppAccessResponseSchema missing");
  for (const servable of [true, false]) {
    const r = s.safeParse({ tenantId: "t1", servable });
    assert.equal(r.success, true, JSON.stringify(r.error?.issues));
    assert.deepEqual(r.data, { tenantId: "t1", servable });
  }
  assert.equal(s.safeParse({ tenantId: "t1", servable: true, plan: "pfp-pro" }).success, false, "strict");
  assert.equal(s.safeParse({ tenantId: "t1", servable: "true" }).success, false, "servable is a boolean, never a string");
  assert.equal(s.safeParse({ tenantId: "", servable: true }).success, false, "tenantId non-empty");
  assert.equal(s.safeParse({ tenantId: "t1" }).success, false, "servable required: absent is unknown, not false");
});

test("EMBED_TOKEN_ERRORS: the six { error } codes the routes answer, with their statuses", () => {
  const e = api.EMBED_TOKEN_ERRORS;
  assert.ok(e, "EMBED_TOKEN_ERRORS missing");
  assert.deepEqual({ ...e }, {
    AGENT_NOT_IN_TENANT: "agent_not_in_tenant",
    AGENT_INACTIVE: "agent_inactive",
    HOME_SCOUT_NOT_ENABLED: "home_scout_not_enabled",
    TENANT_NOT_SERVABLE: "tenant_not_servable",
    EMBED_TOKEN_UNAVAILABLE: "embed_token_unavailable",
    TENANT_APP_ACCESS_UNAVAILABLE: "tenant_app_access_unavailable",
  });
  assert.ok(Object.isFrozen(e));
  assert.deepEqual({ ...api.EMBED_TOKEN_ERROR_STATUS }, {
    agent_not_in_tenant: 404,
    agent_inactive: 409,
    home_scout_not_enabled: 409,
    tenant_not_servable: 409,
    embed_token_unavailable: 503,
    tenant_app_access_unavailable: 503,
  });
});

test("postMessage types: pfp-embed:token-refresh, pfp-embed:token, pfp-embed:session-expired", () => {
  assert.equal(api.EMBED_TOKEN_REFRESH_MESSAGE, "pfp-embed:token-refresh");
  assert.equal(api.EMBED_TOKEN_MESSAGE, "pfp-embed:token");
  assert.equal(api.EMBED_SESSION_EXPIRED_MESSAGE, "pfp-embed:session-expired");
});
