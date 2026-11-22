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


for (const status of [204,503]) test(`cap must reserve in-flight ids and retain their new uses (${status})`, async()=>{
 const s=setup(Array.from({length:10500},(_,i)=>i));
 for(let i=0;i<10000;i++)assert.ok(await s.check(i));
 let release;s.state.reply=()=>new Promise(r=>{release=()=>r(new Response(null,{status}))});
 const p=s.v.flushUsage();
 for(let i=10000;i<10500;i++)assert.ok(await s.check(i));
 assert.ok(await s.check(0)); // existing, unacknowledged id in snapshot
 release();await p;
 s.state.reply=async()=>new Response(null,{status:204});
 const totals=new Map();let notRecorded=0;
 if(status===204)for(const e of s.state.batches[0])totals.set(e.keyId,e.count);
 for(let guard=0;guard<30;guard++){
  const r=await s.v.flushUsage();notRecorded+=r.notRecorded;if(r.outcome==='empty')break;
  for(const e of s.state.batches.at(-1))totals.set(e.keyId,(totals.get(e.keyId)??0)+e.count);
 }
 console.log(JSON.stringify({status,distinct:totals.size,key0:totals.get(A),notRecorded,total:[...totals.values()].reduce((a,b)=>a+b,0)}));
 assert.equal(totals.get(A),2,'an existing id whose flush overlaps must count its second successful use');
 assert.equal(totals.size,10000,'new ids must not use capacity reserved by unacknowledged ids');
 assert.equal(notRecorded,500,'only the 500 genuinely new ids should be refused at the cap');
});
