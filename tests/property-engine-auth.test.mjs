import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getPropertyEngineHeaders,
  hasPropertyEngineCredentials,
} from "../dist/index.js";

// --- getPropertyEngineHeaders ---

test("getPropertyEngineHeaders: returns Bearer auth + JSON content-type", () => {
  const headers = getPropertyEngineHeaders("rello_test_key_abc");
  assert.equal(headers.Authorization, "Bearer rello_test_key_abc");
  assert.equal(headers["Content-Type"], "application/json");
});

test("getPropertyEngineHeaders: accepts legacy-shape literal apiKey (Path B)", () => {
  const headers = getPropertyEngineHeaders("legacy-literal-key");
  assert.equal(headers.Authorization, "Bearer legacy-literal-key");
});

test("getPropertyEngineHeaders: accepts platform-shape rello_ apiKey (Path A)", () => {
  const headers = getPropertyEngineHeaders("rello_abc123def456");
  assert.equal(headers.Authorization, "Bearer rello_abc123def456");
});

test("getPropertyEngineHeaders: returns only 2 keys (no leakage)", () => {
  const headers = getPropertyEngineHeaders("k");
  assert.deepEqual(Object.keys(headers).sort(), [
    "Authorization",
    "Content-Type",
  ]);
});

// --- hasPropertyEngineCredentials ---

test("hasPropertyEngineCredentials: undefined returns false", () => {
  assert.equal(hasPropertyEngineCredentials(undefined), false);
});

test("hasPropertyEngineCredentials: empty string returns false", () => {
  assert.equal(hasPropertyEngineCredentials(""), false);
});

test("hasPropertyEngineCredentials: non-empty string returns true", () => {
  assert.equal(hasPropertyEngineCredentials("rello_abc"), true);
});

test("hasPropertyEngineCredentials: legacy literal returns true", () => {
  assert.equal(hasPropertyEngineCredentials("legacy-key"), true);
});
