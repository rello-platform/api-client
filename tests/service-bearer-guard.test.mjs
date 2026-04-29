import { test } from "node:test";
import assert from "node:assert/strict";
import { createServiceBearerGuard } from "../dist/index.js";

// Minimal Request shim — Node's global Request works in Node 20+.
function req(headers = {}, url = "https://spoke.test/api/provisioning/agent", method = "POST") {
  return new Request(url, { method, headers });
}

const PERMISSION = "provisioning:write";

test("createServiceBearerGuard: missing Bearer header → 401 BEARER_MISSING", async () => {
  const guard = createServiceBearerGuard({
    getValidator: () => async () => {
      throw new Error("validator should not be called");
    },
  });
  const result = await guard(req(), { permission: PERMISSION });
  assert.ok(result instanceof Response);
  assert.equal(result.status, 401);
  const body = await result.json();
  assert.equal(body.code, "BEARER_MISSING");
  assert.equal(body.success, false);
});

test("createServiceBearerGuard: getValidator returns null → 401 BEARER_UNAVAILABLE", async () => {
  const guard = createServiceBearerGuard({ getValidator: () => null });
  const result = await guard(req({ authorization: "Bearer rello_x" }), { permission: PERMISSION });
  assert.ok(result instanceof Response);
  assert.equal(result.status, 401);
  const body = await result.json();
  assert.equal(body.code, "BEARER_UNAVAILABLE");
});

test("createServiceBearerGuard: validator returns null (hash miss) → 401 BEARER_INVALID", async () => {
  const guard = createServiceBearerGuard({ getValidator: () => async () => null });
  const result = await guard(req({ authorization: "Bearer rello_unknown" }), { permission: PERMISSION });
  assert.ok(result instanceof Response);
  assert.equal(result.status, 401);
  const body = await result.json();
  assert.equal(body.code, "BEARER_INVALID");
});

test("createServiceBearerGuard: validator throws → 401 BEARER_VALIDATION_ERROR", async () => {
  const guard = createServiceBearerGuard({
    getValidator: () => async () => {
      throw new Error("network down");
    },
  });
  const result = await guard(req({ authorization: "Bearer rello_x" }), { permission: PERMISSION });
  assert.ok(result instanceof Response);
  assert.equal(result.status, 401);
  const body = await result.json();
  assert.equal(body.code, "BEARER_VALIDATION_ERROR");
});

test("createServiceBearerGuard: caller lacks required permission → 403 PERMISSION_DENIED", async () => {
  const guard = createServiceBearerGuard({
    getValidator: () => async () => ({
      appSource: "RELLO",
      keyId: "ak_test_1",
      permissions: ["intake:write"],
    }),
  });
  const result = await guard(req({ authorization: "Bearer rello_x" }), { permission: PERMISSION });
  assert.ok(result instanceof Response);
  assert.equal(result.status, 403);
  const body = await result.json();
  assert.equal(body.code, "PERMISSION_DENIED");
  assert.match(body.error, /provisioning:write/);
});

test("createServiceBearerGuard: caller with required permission → returns PlatformCaller", async () => {
  const caller = {
    appSource: "RELLO",
    keyId: "ak_test_2",
    permissions: ["provisioning:write"],
  };
  const guard = createServiceBearerGuard({ getValidator: () => async () => caller });
  const result = await guard(req({ authorization: "Bearer rello_ok" }), { permission: PERMISSION });
  assert.ok(!(result instanceof Response));
  assert.equal(result.appSource, "RELLO");
  assert.equal(result.keyId, "ak_test_2");
});

test("createServiceBearerGuard: wildcard '*' permission satisfies any required slug", async () => {
  const guard = createServiceBearerGuard({
    getValidator: () => async () => ({
      appSource: "RELLO",
      keyId: "ak_test_3",
      permissions: ["*"],
    }),
  });
  const result = await guard(req({ authorization: "Bearer rello_wild" }), { permission: PERMISSION });
  assert.ok(!(result instanceof Response));
  assert.equal(result.keyId, "ak_test_3");
});

test("createServiceBearerGuard: non-Bearer Authorization header → 401 BEARER_MISSING", async () => {
  const guard = createServiceBearerGuard({
    getValidator: () => async () => {
      throw new Error("validator should not be called");
    },
  });
  const result = await guard(req({ authorization: "Basic abc" }), { permission: PERMISSION });
  assert.ok(result instanceof Response);
  assert.equal(result.status, 401);
  const body = await result.json();
  assert.equal(body.code, "BEARER_MISSING");
});
