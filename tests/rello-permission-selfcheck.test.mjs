import { test } from "node:test";
import assert from "node:assert/strict";
import { runRelloPermissionSelfCheck, createRelloPermissionSelfCheck } from "../dist/index.js";

const ORIGINAL_FETCH = globalThis.fetch;
const BASE = { relloApiUrl: "https://hellorello.app", relloApiKey: "rello_test_abc", ownAppSource: "newsletter-studio" };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function withFetch(impl, fn) {
  globalThis.fetch = impl;
  try {
    return fn();
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
}

test("ok: own pair + all required perms present", async () => {
  await withFetch(
    async () => jsonResponse({ keyId: "ak_1", appSource: "NEWSLETTER_STUDIO", targetApp: "RELLO", permissions: ["leads:read", "leads:write", "reports:write"], tenantId: null }),
    async () => {
      const r = await runRelloPermissionSelfCheck({ ...BASE, requiredPermissions: ["leads:read", "leads:write"] });
      assert.equal(r.ok, true);
      assert.equal(r.keyId, "ak_1");
      assert.equal(r.appSource, "NEWSLETTER_STUDIO");
    }
  );
});

test("missing-permissions: required slug not on the key", async () => {
  await withFetch(
    async () => jsonResponse({ keyId: "ak_1", appSource: "NEWSLETTER_STUDIO", targetApp: "RELLO", permissions: ["leads:read"], tenantId: null }),
    async () => {
      const r = await runRelloPermissionSelfCheck({ ...BASE, requiredPermissions: ["leads:read", "leads:write", "tags:write"] });
      assert.equal(r.ok, false);
      assert.equal(r.class, "missing-permissions");
      assert.equal(r.keyId, "ak_1");
      assert.deepEqual(r.missing, ["leads:write", "tags:write"]);
    }
  );
});

test("wildcard: '*' satisfies every required slug → ok", async () => {
  await withFetch(
    async () => jsonResponse({ keyId: "ak_star", appSource: "NEWSLETTER_STUDIO", targetApp: "RELLO", permissions: ["*"], tenantId: null }),
    async () => {
      const r = await runRelloPermissionSelfCheck({ ...BASE, requiredPermissions: ["leads:read", "leads:write", "tags:write"] });
      assert.equal(r.ok, true);
      assert.equal(r.keyId, "ak_star");
    }
  );
});

test("wrong-pair: returned appSource != ownAppSource (kebab vs UPPER_SNAKE normalized)", async () => {
  await withFetch(
    async () => jsonResponse({ keyId: "ak_oven", appSource: "THE_OVEN", targetApp: "RELLO", permissions: ["leads:write"], tenantId: null }),
    async () => {
      const r = await runRelloPermissionSelfCheck({ ...BASE, requiredPermissions: ["leads:write"] });
      assert.equal(r.ok, false);
      assert.equal(r.class, "wrong-pair");
      assert.equal(r.expected, "NEWSLETTER_STUDIO");
      assert.equal(r.actual, "THE_OVEN");
    }
  );
});

test("invalid-key: 401 from Rello", async () => {
  await withFetch(
    async () => jsonResponse({ error: "Unauthorized" }, 401),
    async () => {
      const r = await runRelloPermissionSelfCheck({ ...BASE, requiredPermissions: ["leads:write"] });
      assert.equal(r.ok, false);
      assert.equal(r.class, "invalid-key");
    }
  );
});

test("invalid-key: empty wired key short-circuits with no fetch", async () => {
  let fetchCalled = false;
  await withFetch(
    async () => { fetchCalled = true; return jsonResponse({}, 200); },
    async () => {
      const r = await runRelloPermissionSelfCheck({ ...BASE, relloApiKey: "", requiredPermissions: ["leads:write"] });
      assert.equal(r.ok, false);
      assert.equal(r.class, "invalid-key");
      assert.equal(fetchCalled, false);
    }
  );
});

test("rello-unreachable: 503 transient → status number", async () => {
  await withFetch(
    async () => jsonResponse({ error: "Service temporarily unavailable" }, 503),
    async () => {
      const r = await runRelloPermissionSelfCheck({ ...BASE, requiredPermissions: ["leads:write"] });
      assert.equal(r.ok, false);
      assert.equal(r.class, "rello-unreachable");
      assert.equal(r.status, 503);
    }
  );
});

test("rello-unreachable: 404 (route absent / reverted) → never blocks", async () => {
  await withFetch(
    async () => new Response("Not Found", { status: 404 }),
    async () => {
      const r = await runRelloPermissionSelfCheck({ ...BASE, requiredPermissions: ["leads:write"] });
      assert.equal(r.ok, false);
      assert.equal(r.class, "rello-unreachable");
      assert.equal(r.status, 404);
    }
  );
});

test("rello-unreachable: network error → status 'network'", async () => {
  await withFetch(
    async () => { throw new TypeError("fetch failed"); },
    async () => {
      const r = await runRelloPermissionSelfCheck({ ...BASE, requiredPermissions: ["leads:write"] });
      assert.equal(r.ok, false);
      assert.equal(r.class, "rello-unreachable");
      assert.equal(r.status, "network");
    }
  );
});

test("rello-unreachable: timeout (AbortError) → status 'timeout'", async () => {
  await withFetch(
    async () => { throw new DOMException("The operation timed out.", "AbortError"); },
    async () => {
      const r = await runRelloPermissionSelfCheck({ ...BASE, requiredPermissions: ["leads:write"] });
      assert.equal(r.ok, false);
      assert.equal(r.class, "rello-unreachable");
      assert.equal(r.status, "timeout");
    }
  );
});

test("base-URL normalizer strips trailing /api and slashes", async () => {
  let calledUrl = "";
  await withFetch(
    async (url) => { calledUrl = String(url); return jsonResponse({ keyId: "ak_1", appSource: "NEWSLETTER_STUDIO", targetApp: "RELLO", permissions: ["leads:write"], tenantId: null }); },
    async () => {
      await runRelloPermissionSelfCheck({ ...BASE, relloApiUrl: "https://hellorello.app/api/", requiredPermissions: ["leads:write"] });
      assert.equal(calledUrl, "https://hellorello.app/api/v1/platform/service-keys/self");
    }
  );
});

test("createRelloPermissionSelfCheck factory binds config", async () => {
  await withFetch(
    async () => jsonResponse({ keyId: "ak_1", appSource: "NEWSLETTER_STUDIO", targetApp: "RELLO", permissions: ["leads:write"], tenantId: null }),
    async () => {
      const check = createRelloPermissionSelfCheck({ ...BASE, requiredPermissions: ["leads:write"] });
      const r = await check();
      assert.equal(r.ok, true);
    }
  );
});
