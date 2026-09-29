// Which 4xx answers are about OUR credential? Only 401 and 403.
//
// Before 2.28.1 every non-5xx failure on the service-keys refresh failed
// closed, discarding a good key cache. At 2026-09-29T15:30:07Z one edge 409 on
// Milo's refresh (Rello's app logged no 4xx; the request never reached it)
// made Milo refuse every inbound platform token for 5 minutes: 165 refusals,
// 1 scheduled decision and 1 compose-now lost (Nurture KA, AGENT-2-NEW-UNIT-2
// §3B–§3D). A 409, 404 or 429 is not an answer about our credential; it is an
// UNKNOWN from something between us and Rello, and is treated like a 5xx:
// stale-serve inside the existing cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createPlatformKeyValidator } from "../dist/index.js";

const TOKEN = "rello_test_token_4xx_classes";
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest("hex");
const VALID_KEY = { id: "ak_4xx_1", appSource: "RELLO", keyHash: TOKEN_HASH, permissions: [] };
const BASE_CONFIG = { relloApiUrl: "https://hellorello.app", relloApiKey: "rello_upstream_key", ownAppSlug: "milo-engine" };

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_WARN = console.warn;

function authedRequest() {
  return new Request("https://spoke.test/api/inbound", { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` } });
}

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

const ok = () => new Response(JSON.stringify({ keys: [VALID_KEY] }), { status: 200, headers: { "Content-Type": "application/json" } });
const status = (code, statusText) => () => new Response(JSON.stringify({ error: statusText }), { status: code, statusText, headers: { "Content-Type": "application/json" } });

function captureWarnings() {
  const warnings = [];
  console.warn = (...args) => warnings.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  return warnings;
}
function restore() {
  globalThis.fetch = ORIGINAL_FETCH;
  console.warn = ORIGINAL_WARN;
}

/** Populate the cache with a 200, let the TTL lapse, then refresh into `failure`. */
async function populatedThen(failure, extra = {}) {
  mockKeysEndpoint([ok, failure]);
  const warnings = captureWarnings();
  const validate = createPlatformKeyValidator({ ...BASE_CONFIG, cacheTtlMs: 1, ...extra });
  const first = await validate(authedRequest());
  assert.equal(first?.appSource, "RELLO", "setup: the first call must populate the cache");
  await new Promise((r) => setTimeout(r, 5));
  return { validate, warnings };
}

test("🔴 populated cache + edge 409 → stale-serves the good cache (it is not an answer about our credential)", async () => {
  try {
    const { validate, warnings } = await populatedThen(status(409, "Conflict"));
    const result = await validate(authedRequest());
    assert.equal(result?.appSource, "RELLO", "a 409 must stale-serve, not refuse every token");
    const staleWarn = warnings.find((w) => w.includes("WARN serving stale cache"));
    assert.ok(staleWarn, `expected a stale-serve warning, got: ${JSON.stringify(warnings)}`);
    // A distinct status value: never shares a value with 5xx or with 401/403.
    assert.match(staleWarn, /reason=upstream-4xx-other\b/);
    assert.doesNotMatch(staleWarn, /reason=upstream-5xx/);
    assert.match(staleWarn, /status=409\b/);
  } finally {
    restore();
  }
});

test("🔴 the refresh log names the real status and does not call a 409 credential drift", async () => {
  try {
    const { validate, warnings } = await populatedThen(status(409, "Conflict"));
    await validate(authedRequest());
    const fetchWarn = warnings.find((w) => w.includes("Failed to fetch service keys"));
    assert.ok(fetchWarn, `expected the refresh-failure line, got: ${JSON.stringify(warnings)}`);
    assert.match(fetchWarn, /\b409 Conflict\b/);
    assert.doesNotMatch(fetchWarn, /credential drift/);
    assert.match(fetchWarn, /will stale-serve if cache populated/);
  } finally {
    restore();
  }
});

for (const [code, text] of [[404, "Not Found"], [429, "Too Many Requests"], [400, "Bad Request"]]) {
  test(`🔴 populated cache + ${code} → stale-serves too (every 4xx other than 401/403 is unknown)`, async () => {
    try {
      const { validate } = await populatedThen(status(code, text));
      const result = await validate(authedRequest());
      assert.equal(result?.appSource, "RELLO", `${code} must stale-serve`);
    } finally {
      restore();
    }
  });
}

for (const [code, text] of [[401, "Unauthorized"], [403, "Forbidden"]]) {
  test(`populated cache + ${code} → still fails closed, and says credential drift`, async () => {
    try {
      const { validate, warnings } = await populatedThen(status(code, text));
      const result = await validate(authedRequest());
      assert.equal(result, null, `${code} is an answer about our credential: fail closed even with a cache`);
      const fetchWarn = warnings.find((w) => w.includes("Failed to fetch service keys"));
      assert.ok(fetchWarn, `expected the refresh-failure line, got: ${JSON.stringify(warnings)}`);
      assert.match(fetchWarn, new RegExp(`\\b${code} ${text}\\b`));
      assert.match(fetchWarn, /credential drift/);
      assert.ok(!warnings.some((w) => w.includes("WARN serving stale cache")), "a 401/403 must never stale-serve");
    } finally {
      restore();
    }
  });
}

test("no cache yet + 409 → fails closed (nothing to stale-serve)", async () => {
  try {
    mockKeysEndpoint([status(409, "Conflict")]);
    captureWarnings();
    const validate = createPlatformKeyValidator(BASE_CONFIG);
    const result = await validate(authedRequest());
    assert.equal(result, null, "with no successful refresh ever, a 409 must fail closed");
  } finally {
    restore();
  }
});

test("🔴 populated cache + 409 past the stale-serve cap → fails closed, cap warning names 4xx-other and the status", async () => {
  try {
    const { validate, warnings } = await populatedThen(status(409, "Conflict"), { staleServeMaxMs: 10 });
    await new Promise((r) => setTimeout(r, 50));
    const result = await validate(authedRequest());
    assert.equal(result, null, "the cap still bounds a 409 exactly as it bounds a 5xx");
    const capWarn = warnings.find((w) => w.includes("WARN cache exceeded stale-serve cap"));
    assert.ok(capWarn, `expected a cap-exceed warning, got: ${JSON.stringify(warnings)}`);
    assert.match(capWarn, /reason=upstream-4xx-other\b/);
    assert.match(capWarn, /status=409\b/);
  } finally {
    restore();
  }
});
