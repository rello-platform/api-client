// S2b (plan PLATFORM-TRACKING-SYSTEM §9.1 "The done test", §9.2) — batched
// key-usage reporting, anchor-aligned refresh, and tenantId on the caller.
// Platform KA prompt 1613. Every case counts real fetch calls on a stub; the
// clock is Date.now, replaced per test.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createPlatformKeyValidator,
  callerTenantScope,
  isInAnchorWindow,
} from "../dist/index.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_NOW = Date.now;
const ORIGINAL_WARN = console.warn;

let NOW = 0;
function setClock(h, m, s = 0) {
  NOW = Date.UTC(2026, 10, 22, h, m, s);
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  Date.now = ORIGINAL_NOW;
  console.warn = ORIGINAL_WARN;
});

function hash(t) {
  return createHash("sha256").update(t).digest("hex");
}

// cuid-shaped ids, as Rello's ApiKey.id are.
const KEYS = [
  { token: "rello_tok_a", id: "cmabc0000000000000000keya" },
  { token: "rello_tok_b", id: "cmabc0000000000000000keyb" },
  { token: "rello_tok_c", id: "cmabc0000000000000000keyc" },
];

function registryEntry(k, extra = { tenantId: null }) {
  return { id: k.id, appSource: "HARVEST_HOME", keyHash: hash(k.token), permissions: ["tracking:write"], ...extra };
}

/**
 * Counting fetch stub. Every call is recorded with its kind. The registry
 * answer and the touch-batch answers are programmable.
 */
function installFetch({ registry = KEYS.map((k) => registryEntry(k)), batchStatuses = [] } = {}) {
  const calls = [];
  const statuses = [...batchStatuses];
  const state = { registry };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    let kind;
    if (u.includes("/service-keys/touch-batch")) kind = "touch-batch";
    else if (u.includes("/service-keys/touch")) kind = "touch";
    else if (u.includes("/service-keys?")) kind = "registry";
    else kind = "other";
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ kind, url: u, method: opts.method ?? "GET", body });
    if (kind === "registry") {
      return new Response(JSON.stringify({ keys: state.registry }), { status: 200 });
    }
    if (kind === "touch-batch") {
      const status = statuses.length > 0 ? statuses.shift() : 204;
      if (status === "network") throw new TypeError("fetch failed");
      return new Response(status === 204 ? null : "{}", { status });
    }
    return new Response("{}", { status: 200 });
  };
  return { calls, state };
}

function req(token) {
  return new Request("https://engine.test/v1/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

function batchedValidator(extraUsage = {}, extra = {}) {
  Date.now = () => NOW;
  return createPlatformKeyValidator({
    relloApiUrl: "https://rello.test",
    relloApiKey: "rello_engine_outbound",
    ownAppSlug: "tracking-engine",
    cacheTtlMs: 900_000,
    usage: { mode: "batched", ...extraUsage },
    ...extra,
  });
}

const tick = () => new Promise((r) => setImmediate(r));
const count = (calls, kind) => calls.filter((c) => c.kind === kind).length;
function sumBody(call) {
  return call.body.entries.reduce((s, e) => s + e.count, 0);
}

/** 1,000 successful checks across the 3 keys (334 / 333 / 333). */
async function thousandChecks(v) {
  for (let i = 0; i < 1000; i++) {
    const caller = await v(req(KEYS[i % 3].token));
    assert.ok(caller, `check ${i} must succeed`);
  }
}

test("anchor windows: UTC :00–04, :15–19, :30–34, :45–49", () => {
  const at = (m, s = 0) => Date.UTC(2026, 10, 22, 10, m, s);
  assert.equal(isInAnchorWindow(at(0)), true);
  assert.equal(isInAnchorWindow(at(4, 59)), true);
  assert.equal(isInAnchorWindow(at(5)), false);
  assert.equal(isInAnchorWindow(at(14, 59)), false);
  assert.equal(isInAnchorWindow(at(15)), true);
  assert.equal(isInAnchorWindow(at(34, 59)), true);
  assert.equal(isInAnchorWindow(at(45)), true);
  assert.equal(isInAnchorWindow(at(50)), false);
});

test("§9.1 item 1: 1,000 warm-cache validations across 3 keys inside one window make 0 requests", async () => {
  setClock(10, 6);
  const { calls } = installFetch();
  const v = batchedValidator();
  // Warm the cache (a cold isolate fetches the registry at once, even outside a window).
  assert.ok(await v(req(KEYS[0].token)));
  await tick();
  assert.equal(count(calls, "registry"), 1);
  const before = calls.length;
  setClock(10, 7);
  await thousandChecks(v);
  await tick();
  assert.equal(calls.length - before, 0, "no request of any kind during warm checks");
});

test("§9.1 item 2: one window flush makes exactly 1 request naming the 3 keys, counts summing to 1,000", async () => {
  setClock(10, 6);
  const { calls } = installFetch();
  const v = batchedValidator();
  await thousandChecks(v);
  await tick();
  const r = await v.flushUsage();
  assert.equal(r.outcome, "sent");
  const batches = calls.filter((c) => c.kind === "touch-batch");
  assert.equal(batches.length, 1);
  assert.equal(batches[0].method, "POST");
  assert.ok(batches[0].url.endsWith("/api/v1/platform/service-keys/touch-batch"));
  const ids = batches[0].body.entries.map((e) => e.keyId).sort();
  assert.deepEqual(ids, KEYS.map((k) => k.id).sort(), "≤ 1 entry per key, all 3 named");
  assert.equal(sumBody(batches[0]), 1000);
  assert.equal(r.total, 1000);
  assert.equal(count(calls, "touch"), 0, "no per-request touch in batched mode");
  // Acknowledged counts are gone.
  assert.equal((await v.flushUsage()).outcome, "empty");
});

test("§9.1 item 2 (request-driven): the 1,000th check, first in an anchor window after windowMs, hands the flush to defer", async () => {
  setClock(9, 59);
  const { calls } = installFetch();
  const deferred = [];
  const v = batchedValidator({ defer: (p) => deferred.push(p) });
  for (let i = 0; i < 999; i++) assert.ok(await v(req(KEYS[i % 3].token)));
  setClock(10, 15, 0);
  assert.ok(await v(req(KEYS[0].token)));
  assert.equal(deferred.length, 1, "exactly one flush handed to defer");
  const r = await deferred[0];
  assert.equal(r.outcome, "sent");
  const batches = calls.filter((c) => c.kind === "touch-batch");
  assert.equal(batches.length, 1);
  assert.equal(sumBody(batches[0]), 1000);
  // The next check in the same window starts nothing (windowMs not elapsed).
  assert.ok(await v(req(KEYS[1].token)));
  assert.equal(deferred.length, 1);
});

test("§9.1 item 3: a flush with nothing pending makes 0 requests", async () => {
  setClock(10, 6);
  const { calls } = installFetch();
  const v = batchedValidator();
  const r = await v.flushUsage();
  assert.equal(r.outcome, "empty");
  assert.equal(r.entries, 0);
  assert.equal(calls.length, 0);
});

test("§9.1 item 4: a flush answered 503 keeps the counts, and the next flush sends them", async () => {
  setClock(10, 6);
  console.warn = () => {};
  const { calls } = installFetch({ batchStatuses: [503, 204] });
  const v = batchedValidator();
  await thousandChecks(v);
  const first = await v.flushUsage();
  assert.equal(first.outcome, "failed");
  assert.equal(first.httpStatus, 503);
  // Checks made while the counts were held join them.
  for (let i = 0; i < 5; i++) assert.ok(await v(req(KEYS[2].token)));
  const second = await v.flushUsage();
  assert.equal(second.outcome, "sent");
  const batches = calls.filter((c) => c.kind === "touch-batch");
  assert.equal(batches.length, 2);
  assert.equal(sumBody(batches[0]), 1000);
  assert.equal(sumBody(batches[1]), 1005, "the 503'd 1,000 plus the 5 made since");
  const c = batches[1].body.entries.find((e) => e.keyId === KEYS[2].id);
  assert.equal(c.count, 333 + 5);
});

test("§9.1 item 4b: a flush with no answer (network) also keeps the counts", async () => {
  setClock(10, 6);
  console.warn = () => {};
  const { calls } = installFetch({ batchStatuses: ["network", 204] });
  const v = batchedValidator();
  for (let i = 0; i < 9; i++) assert.ok(await v(req(KEYS[i % 3].token)));
  const first = await v.flushUsage();
  assert.equal(first.outcome, "failed");
  assert.equal(first.httpStatus, null);
  const second = await v.flushUsage();
  assert.equal(second.outcome, "sent");
  assert.equal(sumBody(calls.filter((c) => c.kind === "touch-batch")[1]), 9);
});

test("§9.1 item 6: default per-request mode is unchanged — 3 validations make 3 /touch calls", async () => {
  Date.now = ORIGINAL_NOW;
  const { calls } = installFetch();
  const v = createPlatformKeyValidator({
    relloApiUrl: "https://rello.test",
    relloApiKey: "rello_engine_outbound",
    ownAppSlug: "tracking-engine",
  });
  for (let i = 0; i < 3; i++) assert.ok(await v(req(KEYS[i].token)));
  await tick();
  assert.equal(count(calls, "touch"), 3);
  assert.equal(count(calls, "touch-batch"), 0);
  assert.deepEqual(
    calls.filter((c) => c.kind === "touch").map((c) => c.body.keyId),
    KEYS.map((k) => k.id)
  );
  assert.equal((await v.flushUsage()).outcome, "disabled");
});

test("flush fires only inside an anchor window: :14:59 sends nothing, :15:00 sends", async () => {
  setClock(9, 59);
  const { calls } = installFetch();
  const deferred = [];
  const v = batchedValidator({ defer: (p) => deferred.push(p) });
  assert.ok(await v(req(KEYS[0].token)));
  setClock(10, 14, 59); // window elapsed (15m59s), outside an anchor window
  assert.ok(await v(req(KEYS[1].token)));
  await tick();
  assert.equal(deferred.length, 0);
  assert.equal(count(calls, "touch-batch"), 0);
  setClock(10, 15, 0);
  assert.ok(await v(req(KEYS[2].token)));
  assert.equal(deferred.length, 1);
  await deferred[0];
  const batches = calls.filter((c) => c.kind === "touch-batch");
  assert.equal(batches.length, 1);
  assert.equal(sumBody(batches[0]), 3);
});

test("flush waits windowMs even inside an anchor window", async () => {
  setClock(10, 0);
  const { calls } = installFetch();
  const deferred = [];
  const v = batchedValidator({ defer: (p) => deferred.push(p) });
  assert.ok(await v(req(KEYS[0].token)));
  setClock(10, 4, 59);
  assert.ok(await v(req(KEYS[0].token)));
  assert.equal(deferred.length, 0);
  assert.equal(count(calls, "touch-batch"), 0);
});

test("a per-call defer overrides usage.defer", async () => {
  setClock(9, 59);
  installFetch();
  const configDeferred = [];
  const callDeferred = [];
  const v = batchedValidator({ defer: (p) => configDeferred.push(p) });
  assert.ok(await v(req(KEYS[0].token)));
  setClock(10, 15);
  assert.ok(await v(req(KEYS[0].token), { defer: (p) => callDeferred.push(p) }));
  assert.equal(configDeferred.length, 0);
  assert.equal(callDeferred.length, 1);
  assert.equal((await callDeferred[0]).outcome, "sent");
});

test("registry refresh honours alignment after its TTL; a cold validator fetches at once", async () => {
  setClock(10, 7); // outside a window
  const { calls } = installFetch();
  const v = batchedValidator();
  assert.ok(await v(req(KEYS[0].token)));
  assert.equal(count(calls, "registry"), 1, "cold: fetched at once outside a window");
  setClock(10, 22, 1); // TTL (15 min) passed; :22 is outside a window
  assert.ok(await v(req(KEYS[0].token)), "cached keys still served");
  assert.equal(count(calls, "registry"), 1, "no refresh outside an anchor window");
  setClock(10, 30, 0);
  assert.ok(await v(req(KEYS[0].token)));
  assert.equal(count(calls, "registry"), 2, "refreshed at the next anchor window");
});

test("per-request mode keeps the unaligned refresh (TTL only)", async () => {
  setClock(10, 7);
  Date.now = () => NOW;
  const { calls } = installFetch();
  const v = createPlatformKeyValidator({
    relloApiUrl: "https://rello.test",
    relloApiKey: "k",
    ownAppSlug: "tracking-engine",
    cacheTtlMs: 900_000,
  });
  assert.ok(await v(req(KEYS[0].token)));
  setClock(10, 22, 1);
  assert.ok(await v(req(KEYS[0].token)));
  assert.equal(count(calls, "registry"), 2);
});

// Inverted in 2.46.1 (GD-2803, PLATFORM AUDIT 131): v2.46.0 asserted that a
// refresh drops a removed key's pending counts. That lost real successful
// uses. A removed key now fails NEW checks but its past uses are still sent.
test("a key dropped from the registry keeps its pending counts; only new checks fail (GD-2803)", async () => {
  setClock(10, 6);
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(" "));
  const { calls, state } = installFetch();
  const v = batchedValidator({}, { cacheTtlMs: 1 });
  // With cacheTtlMs 1, alignment still holds the refresh to anchor windows.
  setClock(10, 0);
  for (let i = 0; i < 6; i++) assert.ok(await v(req(KEYS[i % 3].token)));
  state.registry = [registryEntry(KEYS[0]), registryEntry(KEYS[1])];
  setClock(10, 1);
  assert.ok(await v(req(KEYS[0].token))); // refresh happens (in window, TTL passed)
  assert.equal(await v(req(KEYS[2].token)), null, "key c no longer registered");
  const r = await v.flushUsage();
  const body = calls.filter((c) => c.kind === "touch-batch")[0].body;
  assert.deepEqual(body.entries.map((e) => e.keyId).sort(), [KEYS[0].id, KEYS[1].id, KEYS[2].id].sort());
  assert.equal(body.entries.find((e) => e.keyId === KEYS[2].id).count, 2, "key c's two real uses are reported");
  assert.equal(r.total, 3 + 2 + 2);
  assert.ok(!warnings.some((w) => w.includes("no longer in the registry")), "nothing is dropped");
});

test("one request never exceeds Rello's 500-entry cap; the rest stay pending", async () => {
  setClock(10, 6);
  const many = Array.from({ length: 501 }, (_, i) => ({
    token: `tok_${i}`,
    id: `cmabc${String(i).padStart(20, "0")}`,
  }));
  const { calls } = installFetch({ registry: many.map((k) => registryEntry(k)) });
  const v = batchedValidator();
  for (const k of many) assert.ok(await v(req(k.token)));
  const a = await v.flushUsage();
  const b = await v.flushUsage();
  const batches = calls.filter((c) => c.kind === "touch-batch");
  assert.equal(batches[0].body.entries.length, 500);
  assert.equal(batches[1].body.entries.length, 1);
  assert.equal(a.entries + b.entries, 501);
  assert.equal((await v.flushUsage()).outcome, "empty");
});

test("§9.2: a registry answer without tenantId → tenantId undefined (unknown), never null", async () => {
  setClock(10, 6);
  const noField = KEYS.map((k) => {
    const e = registryEntry(k);
    delete e.tenantId;
    return e;
  });
  installFetch({ registry: noField });
  const v = batchedValidator();
  const caller = await v(req(KEYS[0].token));
  assert.ok(caller);
  assert.ok("tenantId" in caller, "the field is present on the caller");
  assert.equal(caller.tenantId, undefined);
  assert.notEqual(caller.tenantId, null);
  assert.deepEqual(callerTenantScope(caller), { kind: "unknown" });
});

test("§9.2: tenantId: null → null (platform); a string → that tenant; a malformed value → unknown", async () => {
  setClock(10, 6);
  installFetch({
    registry: [
      registryEntry(KEYS[0], { tenantId: null }),
      registryEntry(KEYS[1], { tenantId: "tenant_abc" }),
      registryEntry(KEYS[2], { tenantId: 42 }),
    ],
  });
  const v = batchedValidator();
  const a = await v(req(KEYS[0].token));
  const b = await v(req(KEYS[1].token));
  const c = await v(req(KEYS[2].token));
  assert.equal(a.tenantId, null);
  assert.deepEqual(callerTenantScope(a), { kind: "platform" });
  assert.equal(b.tenantId, "tenant_abc");
  assert.deepEqual(callerTenantScope(b), { kind: "tenant", tenantId: "tenant_abc" });
  assert.equal(c.tenantId, undefined);
  assert.deepEqual(callerTenantScope(c), { kind: "unknown" });
});

test("§9.2: per-request mode carries tenantId too", async () => {
  Date.now = ORIGINAL_NOW;
  installFetch({ registry: [registryEntry(KEYS[0], { tenantId: "tenant_x" })] });
  const v = createPlatformKeyValidator({ relloApiUrl: "https://rello.test", relloApiKey: "k", ownAppSlug: "x" });
  const caller = await v(req(KEYS[0].token));
  assert.equal(caller.tenantId, "tenant_x");
});

test("concurrent flushUsage calls share one request", async () => {
  setClock(10, 6);
  const { calls } = installFetch();
  const v = batchedValidator();
  for (let i = 0; i < 3; i++) assert.ok(await v(req(KEYS[i].token)));
  const [a, b] = await Promise.all([v.flushUsage(), v.flushUsage()]);
  assert.equal(count(calls, "touch-batch"), 1);
  assert.equal(a, b);
});
