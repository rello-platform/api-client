// GD-2803 (PLATFORM AUDIT 131; Platform KA prompt 1620): a registry refresh
// must never delete pending usage. A key that is revoked, expired or
// retargeted after it was used still had those successful uses; they leave
// the map only when a flush Rello acknowledged (2xx) carried them. The only
// bound is a backstop of 10,000 distinct pending key ids.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createPlatformKeyValidator } from "../dist/index.js";

const ORIGINAL = { fetch: globalThis.fetch, now: Date.now, warn: console.warn };
afterEach(() => {
  globalThis.fetch = ORIGINAL.fetch;
  Date.now = ORIGINAL.now;
  console.warn = ORIGINAL.warn;
});

const hash = (t) => createHash("sha256").update(t).digest("hex");
const entry = (i) => ({ id: `ak_1795000000000_${String(i).padStart(8, "0")}`, appSource: "HARVEST_HOME", keyHash: hash(`tok_${i}`), permissions: [], tenantId: null });

/**
 * A batched validator in an anchor window with a 1 s registry TTL, so a check
 * after `advance()` refreshes the registry. windowMs is huge: flushes happen
 * only when the test calls flushUsage().
 */
function setup(registryIds = [0, 1]) {
  let now = Date.UTC(2026, 10, 22, 10, 1, 0);
  Date.now = () => now;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.map(String).join(" "));
  const state = {
    registry: registryIds.map(entry),
    batches: [],
    registryFetches: 0,
    reply: async () => new Response(null, { status: 204 }),
  };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/touch-batch")) {
      state.batches.push(JSON.parse(opts.body).entries);
      return state.reply();
    }
    state.registryFetches += 1;
    return new Response(JSON.stringify({ keys: state.registry }), { status: 200 });
  };
  const v = createPlatformKeyValidator({
    relloApiUrl: "https://rello.test",
    relloApiKey: "outbound",
    ownAppSlug: "tracking-engine",
    cacheTtlMs: 1000,
    usage: { mode: "batched", windowMs: 1e12 },
  });
  const check = (i) =>
    v(new Request("https://engine.test/v1/events", { headers: { Authorization: `Bearer tok_${i}` } }));
  const advance = (ms = 2000) => {
    now += ms;
  };
  return { v, state, check, advance, warnings };
}

const asMap = (entries) => Object.fromEntries(entries.map((e) => [e.keyId, e.count]));
const A = entry(0).id;
const B = entry(1).id;

/** Remove key 0 from the registry and make a check on key 1 refresh it. */
async function dropKeyAViaRefresh(s) {
  s.state.registry = [entry(1)];
  s.advance();
  const before = s.state.registryFetches;
  assert.ok(await s.check(1), "key 1 still authenticates");
  assert.equal(s.state.registryFetches, before + 1, "the check refreshed the registry");
  assert.equal(await s.check(0), null, "key 0 no longer authenticates a NEW check");
}

test("GD-2803 (1): one use → flush 503 → refresh drops the key → next flush still sends count 1", async () => {
  const s = setup();
  assert.ok(await s.check(0));
  s.state.reply = async () => new Response("{}", { status: 503 });
  assert.equal((await s.v.flushUsage()).outcome, "failed");
  await dropKeyAViaRefresh(s);
  s.state.reply = async () => new Response(null, { status: 204 });
  const r = await s.v.flushUsage();
  assert.equal(r.outcome, "sent");
  const sent = asMap(s.state.batches.at(-1));
  assert.equal(sent[A], 1, "the removed key's real use is reported");
  assert.equal(sent[B], 1);
  assert.ok(!s.warnings.some((w) => w.includes("no longer in the registry")));
});

test("GD-2803 (2): use → flush held open → second use → refresh drops the key → flush 503 → next flush sends 2", async () => {
  const s = setup();
  assert.ok(await s.check(0));
  let release;
  s.state.reply = () => new Promise((r) => { release = () => r(new Response("{}", { status: 503 })); });
  const inFlight = s.v.flushUsage();
  await new Promise((r) => setImmediate(r));
  assert.ok(await s.check(0), "a use made while the flush is in flight");
  await dropKeyAViaRefresh(s);
  release();
  assert.equal((await inFlight).outcome, "failed");
  s.state.reply = async () => new Response(null, { status: 204 });
  await s.v.flushUsage();
  assert.equal(asMap(s.state.batches.at(-1))[A], 2, "the put-back 1 plus the in-flight 1");
});

test("GD-2803 (3): the same with a 204 flush — the in-flight use is sent next (1)", async () => {
  const s = setup();
  assert.ok(await s.check(0));
  let release;
  s.state.reply = () => new Promise((r) => { release = () => r(new Response(null, { status: 204 })); });
  const inFlight = s.v.flushUsage();
  await new Promise((r) => setImmediate(r));
  assert.ok(await s.check(0));
  await dropKeyAViaRefresh(s);
  release();
  assert.equal((await inFlight).outcome, "sent");
  assert.equal(asMap(s.state.batches[0])[A], 1);
  s.state.reply = async () => new Response(null, { status: 204 });
  await s.v.flushUsage();
  assert.equal(asMap(s.state.batches.at(-1))[A], 1, "acknowledged once, the in-flight use reported once");
});

test("GD-2803 (4): the 10,000-id backstop — a NEW id is not added and the warn names it; an existing id still counts", async () => {
  const N = 10_001;
  const s = setup(Array.from({ length: N }, (_, i) => i));
  s.state.reply = async () => new Response("{}", { status: 503 });
  for (let i = 0; i < 10_000; i++) assert.ok(await s.check(i));
  assert.equal((await s.v.flushUsage()).outcome, "failed", "Rello refuses; nothing leaves the map");
  // At the cap: id 10,000 is new; it still authenticates but is not recorded.
  assert.ok(await s.check(10_000), "auth is unaffected by the usage cap");
  assert.ok(await s.check(10_000));
  assert.ok(await s.check(5), "an existing id keeps counting");
  const failed = await s.v.flushUsage();
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.notRecorded, 2, "the flush result names the uses not recorded");
  const capWarns = s.warnings.filter((w) => w.includes("not recorded"));
  assert.equal(capWarns.length, 1, "one warn for the window");
  assert.match(capWarns[0], /2 use\(s\)/);
  // Rello recovers: drain the map and look at what was recorded.
  s.state.reply = async () => new Response(null, { status: 204 });
  const totals = new Map();
  for (let guard = 0; guard < 40; guard++) {
    const r = await s.v.flushUsage();
    if (r.outcome === "empty") break;
    for (const e of s.state.batches.at(-1)) totals.set(e.keyId, (totals.get(e.keyId) ?? 0) + e.count);
  }
  assert.equal(totals.size, 10_000, "exactly the 10,000 ids that entered");
  assert.equal(totals.has(entry(10_000).id), false, "the id that arrived at the cap was not added");
  assert.equal(totals.get(entry(5).id), 2, "the existing id counted past the cap");
  assert.equal([...totals.values()].reduce((a, b) => a + b, 0), 10_001);
  // The counter resets once named: the next flush window names nothing.
  assert.equal(s.warnings.filter((w) => w.includes("not recorded")).length, 1);
});

test("GD-2803 (5): a refresh with pending counts for listed ids changes nothing", async () => {
  const s = setup();
  for (let i = 0; i < 3; i++) assert.ok(await s.check(0));
  for (let i = 0; i < 2; i++) assert.ok(await s.check(1));
  s.advance();
  const before = s.state.registryFetches;
  assert.ok(await s.check(1));
  assert.equal(s.state.registryFetches, before + 1);
  await s.v.flushUsage();
  assert.deepEqual(asMap(s.state.batches[0]), { [A]: 3, [B]: 3 });
});
