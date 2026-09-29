// Why did the validator return null? (D-83, second half)
//
// Before 2.28.1 a consumer could not tell "no key matched this token" from
// "the validator refused every token" (401/403 on refresh, no cache yet, or
// stale-serve cap exceeded): all six null returns were the same bare `null`.
// Milo logged "platform bearer token did not match any active key" for the
// 2026-09-29 15:30Z refusal episode, when the token DID match the cached key,
// which sent the investigation toward the key and the grant.
//
// `validator.reasonFor(request)` reads the reason recorded for THAT request
// (keyed by the Request object, so concurrent requests cannot see each
// other's reason). It never changes what the validator returns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createPlatformKeyValidator } from "../dist/index.js";

const TOKEN = "rello_test_token_null_reason";
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest("hex");
const VALID_KEY = { id: "ak_nr_1", appSource: "RELLO", keyHash: TOKEN_HASH, permissions: [] };
const BASE_CONFIG = { relloApiUrl: "https://hellorello.app", relloApiKey: "rello_upstream_key", ownAppSlug: "milo-engine" };

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_WARN = console.warn;

const req = (auth) => new Request("https://spoke.test/api/inbound", { method: "POST", headers: auth ? { Authorization: auth } : {} });
const ok = () => new Response(JSON.stringify({ keys: [VALID_KEY] }), { status: 200, headers: { "Content-Type": "application/json" } });
const status = (code, statusText) => () => new Response("{}", { status: code, statusText, headers: { "Content-Type": "application/json" } });

function mockKeysEndpoint(responses) {
  const queue = [...responses];
  let last = responses[responses.length - 1];
  globalThis.fetch = async (url) => {
    if (String(url).includes("/service-keys/touch")) return new Response("{}", { status: 200 });
    const next = queue.length > 0 ? queue.shift() : last;
    last = next;
    return next();
  };
}
function quiet() { console.warn = () => {}; }
function restore() { globalThis.fetch = ORIGINAL_FETCH; console.warn = ORIGINAL_WARN; }

async function populatedThen(failure, extra = {}) {
  mockKeysEndpoint([ok, failure]);
  quiet();
  const validate = createPlatformKeyValidator({ ...BASE_CONFIG, cacheTtlMs: 1, ...extra });
  const first = await validate(req(`Bearer ${TOKEN}`));
  assert.equal(first?.appSource, "RELLO", "setup: the first call must populate the cache");
  await new Promise((r) => setTimeout(r, 5));
  return validate;
}

test("🔴 the validator exposes reasonFor(request)", () => {
  const validate = createPlatformKeyValidator(BASE_CONFIG);
  assert.equal(typeof validate.reasonFor, "function", "no public way to ask why the validator returned null");
});

test("🔴 a token that matches no key → reason no-key-match", async () => {
  try {
    mockKeysEndpoint([ok]);
    quiet();
    const validate = createPlatformKeyValidator(BASE_CONFIG);
    const r = req("Bearer rello_some_other_token");
    assert.equal(await validate(r), null);
    assert.deepEqual(validate.reasonFor(r), { reason: "no-key-match", httpStatus: null });
  } finally {
    restore();
  }
});

for (const [code, text] of [[401, "Unauthorized"], [403, "Forbidden"]]) {
  test(`🔴 a refresh ${code} with a good cache → reason auth-refused, status ${code} (the token itself matched)`, async () => {
    try {
      const validate = await populatedThen(status(code, text));
      const r = req(`Bearer ${TOKEN}`);
      assert.equal(await validate(r), null);
      assert.deepEqual(validate.reasonFor(r), { reason: "auth-refused", httpStatus: code });
    } finally {
      restore();
    }
  });
}

test("🔴 no successful refresh yet → reason no-cache, with the failing status", async () => {
  try {
    mockKeysEndpoint([status(409, "Conflict")]);
    quiet();
    const validate = createPlatformKeyValidator(BASE_CONFIG);
    const r = req(`Bearer ${TOKEN}`);
    assert.equal(await validate(r), null);
    assert.deepEqual(validate.reasonFor(r), { reason: "no-cache", httpStatus: 409 });
  } finally {
    restore();
  }
});

test("🔴 past the stale-serve cap → reason stale-cap-exceeded, with the failing status", async () => {
  try {
    const validate = await populatedThen(status(503, "Service Unavailable"), { staleServeMaxMs: 10 });
    await new Promise((r) => setTimeout(r, 50));
    const r = req(`Bearer ${TOKEN}`);
    assert.equal(await validate(r), null);
    assert.deepEqual(validate.reasonFor(r), { reason: "stale-cap-exceeded", httpStatus: 503 });
  } finally {
    restore();
  }
});

test("🔴 no Bearer header → reason no-bearer", async () => {
  try {
    mockKeysEndpoint([ok]);
    quiet();
    const validate = createPlatformKeyValidator(BASE_CONFIG);
    const r = req(null);
    assert.equal(await validate(r), null);
    assert.deepEqual(validate.reasonFor(r), { reason: "no-bearer", httpStatus: null });
  } finally {
    restore();
  }
});

test("a successful call records no reason, and a request never validated has none", async () => {
  try {
    mockKeysEndpoint([ok]);
    quiet();
    const validate = createPlatformKeyValidator(BASE_CONFIG);
    const r = req(`Bearer ${TOKEN}`);
    assert.equal((await validate(r))?.appSource, "RELLO");
    assert.equal(validate.reasonFor(r), undefined);
    assert.equal(validate.reasonFor(req(`Bearer ${TOKEN}`)), undefined);
  } finally {
    restore();
  }
});

test("🔴 concurrent requests keep their own reasons (no shared last-reason field)", async () => {
  try {
    mockKeysEndpoint([ok]);
    quiet();
    const validate = createPlatformKeyValidator(BASE_CONFIG);
    const miss = req("Bearer rello_not_a_key");
    const hit = req(`Bearer ${TOKEN}`);
    const bare = req(null);
    const [a, b, c] = await Promise.all([validate(miss), validate(hit), validate(bare)]);
    assert.equal(a, null);
    assert.equal(b?.appSource, "RELLO");
    assert.equal(c, null);
    assert.equal(validate.reasonFor(miss)?.reason, "no-key-match");
    assert.equal(validate.reasonFor(hit), undefined);
    assert.equal(validate.reasonFor(bare)?.reason, "no-bearer");
  } finally {
    restore();
  }
});
