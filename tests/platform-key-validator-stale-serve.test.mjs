import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createPlatformKeyValidator } from "../dist/index.js";

// Pre-compute a token + its SHA-256 hash so the mock can return the hash
// and the validator's lookup will match.
const TOKEN = "rello_test_token_abc";
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest("hex");

const VALID_KEY = {
  id: "ak_test_1",
  appSource: "RELLO",
  keyHash: TOKEN_HASH,
  permissions: ["intake:write"],
};

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_WARN = console.warn;

function authedRequest(token = TOKEN) {
  return new Request("https://spoke.test/api/inbound", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Build a fetch mock with a programmable response queue scoped to the
 * `/service-keys` GET. The validator also fires a fire-and-forget POST to
 * `/service-keys/touch` for `lastUsedAt` attribution — those calls are
 * always answered with a 200 OK and are NOT consumed from the queue.
 *
 * Each call to fetch() against `/service-keys` (without `/touch`) shifts
 * the next response off the queue. If the queue is empty, the last queued
 * response is reused (steady-state).
 */
function makeFetchMock(responses) {
  const queue = [...responses];
  const calls = [];
  let last = responses[responses.length - 1];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    calls.push({ url: u, opts });
    if (u.includes("/service-keys/touch")) {
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const next = queue.length > 0 ? queue.shift() : last;
    last = next;
    if (typeof next === "function") return next();
    return next;
  };
  return calls;
}

function okResponse(keys = [VALID_KEY]) {
  return new Response(JSON.stringify({ keys }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function status5xx(status = 503) {
  return new Response(JSON.stringify({ error: "Service temporarily unavailable" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function status4xx(status = 401) {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function captureWarnings() {
  const warnings = [];
  console.warn = (...args) => {
    warnings.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  return warnings;
}

function restoreGlobals() {
  globalThis.fetch = ORIGINAL_FETCH;
  console.warn = ORIGINAL_WARN;
}

const BASE_CONFIG = {
  relloApiUrl: "https://hellorello.app",
  relloApiKey: "rello_upstream_key",
  ownAppSlug: "newsletter-studio",
};

test("populated cache + 5xx fetch → serves stale + emits stale-serve warning", async () => {
  try {
    makeFetchMock([okResponse(), status5xx(503)]);
    const warnings = captureWarnings();
    // Tight cacheTtlMs so the second call triggers a refresh attempt.
    const validate = createPlatformKeyValidator({ ...BASE_CONFIG, cacheTtlMs: 1 });

    // First call populates cache (200).
    const first = await validate(authedRequest());
    assert.equal(first?.appSource, "RELLO", "first call should match cached key");

    // Wait past TTL so ensureFreshCache attempts a refresh on the next call.
    await new Promise((r) => setTimeout(r, 5));

    // Second call: refresh sees 5xx but populated cache → stale-serve.
    const second = await validate(authedRequest());
    assert.equal(second?.appSource, "RELLO", "should serve stale on 5xx");

    const staleWarn = warnings.find((w) => w.includes("WARN serving stale cache"));
    assert.ok(staleWarn, `expected stale-serve warning, got: ${JSON.stringify(warnings)}`);
    assert.match(staleWarn, /reason=upstream-5xx/);
  } finally {
    restoreGlobals();
  }
});

test("populated cache + 5xx exceeds cap → fail-closed + emits cap-exceed warning", async () => {
  try {
    makeFetchMock([okResponse(), status5xx(503)]);
    const warnings = captureWarnings();
    // cacheTtlMs=1ms + staleServeMaxMs=10ms → cap = 11ms total stale.
    const validate = createPlatformKeyValidator({
      ...BASE_CONFIG,
      cacheTtlMs: 1,
      staleServeMaxMs: 10,
    });

    // Populate cache.
    const first = await validate(authedRequest());
    assert.equal(first?.appSource, "RELLO");

    // Wait past cap (cacheTtlMs + staleServeMaxMs = 11ms; sleep 50ms to be safe).
    await new Promise((r) => setTimeout(r, 50));

    // Trigger refresh that 5xxs; cache is now stale > cap.
    const second = await validate(authedRequest());
    assert.equal(second, null, "should fail-closed past stale-serve cap");

    const capWarn = warnings.find((w) => w.includes("WARN cache exceeded stale-serve cap"));
    assert.ok(capWarn, `expected cap-exceed warning, got: ${JSON.stringify(warnings)}`);
    assert.match(capWarn, /reason=upstream-5xx/);
  } finally {
    restoreGlobals();
  }
});

test("empty cache + 5xx fetch → fail-closed (pre-first-success)", async () => {
  try {
    makeFetchMock([status5xx(503)]);
    captureWarnings();
    const validate = createPlatformKeyValidator(BASE_CONFIG);

    const result = await validate(authedRequest());
    assert.equal(result, null, "should fail-closed before first successful fetch");
  } finally {
    restoreGlobals();
  }
});

test("populated cache + 200 fetch → refreshes + clears stale-serve state", async () => {
  try {
    makeFetchMock([okResponse(), status5xx(503), okResponse()]);
    const warnings = captureWarnings();
    const validate = createPlatformKeyValidator({ ...BASE_CONFIG, cacheTtlMs: 1 });

    // Populate cache.
    await validate(authedRequest());
    await new Promise((r) => setTimeout(r, 5));

    // Stale-serve.
    const stale = await validate(authedRequest());
    assert.equal(stale?.appSource, "RELLO");
    const staleEmitsBefore = warnings.filter((w) => w.includes("WARN serving stale cache")).length;
    assert.ok(staleEmitsBefore >= 1);
    await new Promise((r) => setTimeout(r, 5));

    // Recovery: next refresh succeeds → flags reset.
    const recovered = await validate(authedRequest());
    assert.equal(recovered?.appSource, "RELLO");

    // Force another refresh attempt with a fresh stale-serve scenario; warning should re-emit.
    globalThis.fetch = async () => status5xx(503);
    await new Promise((r) => setTimeout(r, 5));
    await validate(authedRequest());
    const staleEmitsAfter = warnings.filter((w) => w.includes("WARN serving stale cache")).length;
    assert.ok(
      staleEmitsAfter > staleEmitsBefore,
      "stale-serve warning should re-emit after a successful recovery"
    );
  } finally {
    restoreGlobals();
  }
});

test("populated cache + 4xx fetch → fail-closed (do not mask credential drift)", async () => {
  try {
    makeFetchMock([okResponse(), status4xx(401)]);
    const warnings = captureWarnings();
    const validate = createPlatformKeyValidator({ ...BASE_CONFIG, cacheTtlMs: 1 });

    await validate(authedRequest());
    await new Promise((r) => setTimeout(r, 5));

    const result = await validate(authedRequest());
    assert.equal(result, null, "4xx must fail-closed even with populated cache");

    const credDriftWarn = warnings.find((w) => w.includes("4xx") && w.includes("credential drift"));
    assert.ok(credDriftWarn, `expected 4xx credential-drift warning, got: ${JSON.stringify(warnings)}`);
  } finally {
    restoreGlobals();
  }
});

test("populated cache + network error → stale-serves with reason=upstream-network", async () => {
  try {
    const warnings = [];
    console.warn = (...args) => warnings.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));

    let serviceKeysCalls = 0;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/service-keys/touch")) {
        return new Response("{}", { status: 200 });
      }
      serviceKeysCalls += 1;
      if (serviceKeysCalls === 1) return okResponse();
      throw new TypeError("fetch failed: network down");
    };

    const validate = createPlatformKeyValidator({ ...BASE_CONFIG, cacheTtlMs: 1 });
    await validate(authedRequest());
    await new Promise((r) => setTimeout(r, 5));

    const result = await validate(authedRequest());
    assert.equal(result?.appSource, "RELLO", "should stale-serve on network error");

    const networkWarn = warnings.find((w) => w.includes("WARN serving stale cache") && w.includes("reason=upstream-network"));
    assert.ok(networkWarn, `expected network stale-serve warning, got: ${JSON.stringify(warnings)}`);
  } finally {
    restoreGlobals();
  }
});

test("staleServeMaxMs=0 disables stale-serve (v2.10.0 backward-compat escape hatch)", async () => {
  try {
    makeFetchMock([okResponse(), status5xx(503)]);
    captureWarnings();
    const validate = createPlatformKeyValidator({
      ...BASE_CONFIG,
      cacheTtlMs: 1,
      staleServeMaxMs: 0,
    });

    await validate(authedRequest());
    await new Promise((r) => setTimeout(r, 5));

    const result = await validate(authedRequest());
    assert.equal(result, null, "staleServeMaxMs=0 should fail-closed on 5xx after first fetch");
  } finally {
    restoreGlobals();
  }
});

test("v2.10.0 callers without staleServeMaxMs config get 30-min default (zero-touch upgrade)", async () => {
  try {
    // Simulates a v2.10.0 caller that never set staleServeMaxMs.
    // Verify the default (30 min) is large enough to stale-serve on a quick 5xx.
    makeFetchMock([okResponse(), status5xx(503)]);
    captureWarnings();
    const validate = createPlatformKeyValidator({ ...BASE_CONFIG, cacheTtlMs: 1 });

    await validate(authedRequest());
    await new Promise((r) => setTimeout(r, 5));

    const result = await validate(authedRequest());
    assert.equal(
      result?.appSource,
      "RELLO",
      "default 30-min cap should be large enough to stale-serve a fast 5xx"
    );
  } finally {
    restoreGlobals();
  }
});

test("emit-once gating: stale-serve warning emits once across multiple inbound requests", async () => {
  try {
    let serviceKeysCalls = 0;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/service-keys/touch")) {
        return new Response("{}", { status: 200 });
      }
      serviceKeysCalls += 1;
      return serviceKeysCalls === 1 ? okResponse() : status5xx(503);
    };
    const warnings = [];
    console.warn = (...args) => warnings.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));

    const validate = createPlatformKeyValidator({ ...BASE_CONFIG, cacheTtlMs: 1 });
    await validate(authedRequest()); // populate
    await new Promise((r) => setTimeout(r, 5));

    // Force the failure-status to be set by triggering a refresh on a stale TTL,
    // then make subsequent requests cheap (under TTL again so no new refresh).
    await validate(authedRequest());
    const after1 = warnings.filter((w) => w.includes("WARN serving stale cache")).length;

    // Subsequent inbound requests within TTL should NOT re-emit.
    await validate(authedRequest());
    await validate(authedRequest());
    const after3 = warnings.filter((w) => w.includes("WARN serving stale cache")).length;

    assert.equal(after3, after1, "stale-serve warning must not re-emit per inbound request");
  } finally {
    restoreGlobals();
  }
});
