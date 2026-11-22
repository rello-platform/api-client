// GD-2825 (PLATFORM AUDIT 131, prompt 1623; Platform KA prompt 1625): ids
// carried by an in-flight flush are still unacknowledged. They count as
// existing at the add site and toward the 10,000-id backstop until the flush
// settles; a 2xx frees their slots, a failure puts them back.
// The auditor's own cases are tests/audit131-1623-cap.test.mjs (verbatim).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createPlatformKeyValidator, USAGE_MAX_PENDING_KEYS } from "../dist/index.js";

const ORIGINAL = { fetch: globalThis.fetch, now: Date.now, warn: console.warn };
afterEach(() => {
  globalThis.fetch = ORIGINAL.fetch;
  Date.now = ORIGINAL.now;
  console.warn = ORIGINAL.warn;
});

const hash = (t) => createHash("sha256").update(t).digest("hex");
const id = (i) => `ak_1795000000000_${String(i).padStart(8, "0")}`;
const entry = (i) => ({ id: id(i), appSource: "HARVEST_HOME", keyHash: hash(`tok_${i}`), permissions: [], tenantId: null });

function setup(n) {
  Date.now = () => Date.UTC(2026, 10, 22, 10, 1, 0);
  console.warn = () => {};
  const state = { batches: [], reply: async () => new Response(null, { status: 204 }) };
  const registry = Array.from({ length: n }, (_, i) => entry(i));
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes("/touch-batch")) {
      state.batches.push(JSON.parse(opts.body).entries);
      return state.reply();
    }
    return new Response(JSON.stringify({ keys: registry }), { status: 200 });
  };
  const v = createPlatformKeyValidator({
    relloApiUrl: "https://rello.test",
    relloApiKey: "outbound",
    ownAppSlug: "tracking-engine",
    usage: { mode: "batched", windowMs: 1e12 },
  });
  const check = (i) => v(new Request("https://engine.test/v1/events", { headers: { Authorization: `Bearer tok_${i}` } }));
  const hold = (status) => {
    let release;
    state.reply = () => new Promise((r) => { release = () => r(new Response(status === 204 ? null : "{}", { status })); });
    return () => release();
  };
  /** Flush until empty with 204s; sum counts per id. */
  const drain = async () => {
    state.reply = async () => new Response(null, { status: 204 });
    const totals = new Map();
    let notRecorded = 0;
    for (let guard = 0; guard < 40; guard++) {
      const r = await v.flushUsage();
      notRecorded += r.notRecorded;
      if (r.outcome === "empty") break;
      for (const e of state.batches.at(-1)) totals.set(e.keyId, (totals.get(e.keyId) ?? 0) + e.count);
    }
    return { totals, notRecorded };
  };
  return { v, state, check, hold, drain };
}

test("guard: below the cap, a new id arriving during a flush is admitted and sent next", async () => {
  const s = setup(3);
  assert.ok(await s.check(0));
  const release = s.hold(204);
  const p = s.v.flushUsage();
  await new Promise((r) => setImmediate(r));
  assert.ok(await s.check(1), "new id during the flush");
  assert.ok(await s.check(0), "in-flight id used again");
  release();
  const r = await p;
  assert.equal(r.outcome, "sent");
  assert.deepEqual(s.state.batches[0], [{ keyId: id(0), count: 1 }]);
  const { totals, notRecorded } = await s.drain();
  assert.deepEqual(Object.fromEntries(totals), { [id(0)]: 1, [id(1)]: 1 });
  assert.equal(notRecorded, 0);
});

test("a 2xx frees the in-flight slots: at the cap, a flush of 500 acknowledged admits 500 new ids", async () => {
  assert.equal(USAGE_MAX_PENDING_KEYS, 10_000);
  const s = setup(10_500);
  for (let i = 0; i < 10_000; i++) assert.ok(await s.check(i));
  const sent = await s.v.flushUsage(); // 204, carries ids 0..499
  assert.equal(sent.outcome, "sent");
  assert.equal(sent.entries, 500);
  for (let i = 10_000; i < 10_500; i++) assert.ok(await s.check(i));
  const { totals, notRecorded } = await s.drain();
  assert.equal(notRecorded, 0, "the acknowledged ids no longer hold slots");
  assert.equal(totals.size, 10_000, "9,500 still pending + 500 new");
  assert.equal(totals.get(id(10_499)), 1);
  assert.equal(totals.has(id(0)), false, "acknowledged once, not resent");
});

test("after a failed flush's put-back, distinct unacknowledged ids are still at most 10,000", async () => {
  const s = setup(10_001);
  for (let i = 0; i < 10_000; i++) assert.ok(await s.check(i));
  const release = s.hold(503);
  const p = s.v.flushUsage();
  await new Promise((r) => setImmediate(r));
  assert.ok(await s.check(10_000), "new id during the flush: authenticates, not recorded");
  release();
  assert.equal((await p).outcome, "failed");
  assert.ok(await s.check(10_000), "still refused after the put-back");
  const { totals, notRecorded } = await s.drain();
  assert.equal(totals.size, 10_000);
  assert.equal(totals.has(id(10_000)), false);
  assert.equal(notRecorded, 2);
});
