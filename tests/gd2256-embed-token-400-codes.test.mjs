import { test } from "node:test";
import assert from "node:assert/strict";
import * as api from "../dist/index.js";

// PLATFORM AUDIT 114 GD-2256 (Platform KA 1328): Rello's three P-2 routes
// (POST /api/v1/embed-tokens, POST /api/v1/embed-tokens/verify,
// GET /api/v1/platform/tenant-app-access) answer two 400 bodies that the
// exported error map left out, so a caller classifying Rello's answers by this
// map had no entry for them.

// Shaped exactly as Rello answers them (Rello #2465: route.ts answer(..., 400)
// for an unknown key and for a bad body; the same two codes in verify and F2).
const SERVED_400 = [
  { error: "UNKNOWN_FIELD", field: "tenantId" },
  { error: "invalid_body", message: "surface must be one of: identity, rate-widget" },
  { error: "invalid_body", message: "token must be a non-empty string" },
  { error: "invalid_body", message: "exactly one non-empty tenantId query parameter is required" },
];

test("GD-2256: EMBED_TOKEN_ERRORS names the two 400 codes the routes answer", () => {
  const codes = Object.values(api.EMBED_TOKEN_ERRORS);
  assert.ok(codes.includes("UNKNOWN_FIELD"), "UNKNOWN_FIELD missing");
  assert.ok(codes.includes("invalid_body"), "invalid_body missing");
  assert.equal(api.EMBED_TOKEN_ERRORS.UNKNOWN_FIELD, "UNKNOWN_FIELD");
  assert.equal(api.EMBED_TOKEN_ERRORS.INVALID_BODY, "invalid_body");
});

test("GD-2256: every served 400 body's code maps to 400", () => {
  for (const body of SERVED_400) {
    assert.equal(api.EMBED_TOKEN_ERROR_STATUS[body.error], 400, JSON.stringify(body));
  }
});

test("GD-2256: the map has a status for every code, and only statuses the routes answer", () => {
  const codes = Object.values(api.EMBED_TOKEN_ERRORS);
  assert.deepEqual(Object.keys(api.EMBED_TOKEN_ERROR_STATUS).sort(), [...codes].sort());
  assert.deepEqual([...new Set(Object.values(api.EMBED_TOKEN_ERROR_STATUS))].sort(), [400, 404, 409, 503]);
});
