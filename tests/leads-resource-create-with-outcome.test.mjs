// A-852 (D-395) — leads.createWithOutcome() returns Rello's `created`: true for
// an insert, false for a lead the dedupe returned, null when the response does
// not say. leads.create() is unchanged (still the bare Lead).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRelloClient } from "../dist/index.js";

const LEAD = { id: "lead_1", email: "v@example.com", firstName: "V", lastName: "Visitor", tenantId: "t1" };

async function withClient(body, fn) {
  const prevFetch = globalThis.fetch;
  const prev = { url: process.env.RELLO_API_URL, key: process.env.RELLO_API_KEY, slug: process.env.APP_SLUG };
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), { status: 201, headers: { "content-type": "application/json" } });
  process.env.RELLO_API_URL = "https://test.invalid";
  process.env.RELLO_API_KEY = "test-key";
  process.env.APP_SLUG = "test-spoke";
  try {
    return await fn(createRelloClient());
  } finally {
    globalThis.fetch = prevFetch;
    for (const [k, v] of [["RELLO_API_URL", prev.url], ["RELLO_API_KEY", prev.key], ["APP_SLUG", prev.slug]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test("createWithOutcome: an INSERT → created: true, lead unwrapped from Rello's envelope", async () => {
  await withClient({ success: true, data: { lead: LEAD, created: true } }, async (c) => {
    const r = await c.leads.createWithOutcome("t1", { email: LEAD.email });
    assert.equal(r.created, true);
    assert.equal(r.lead.id, "lead_1");
    assert.equal("lead" in r.lead, false);
  });
});

test("createWithOutcome: a DEDUPE return → created: false", async () => {
  await withClient({ success: true, data: { lead: LEAD, created: false, duplicates: [] } }, async (c) => {
    const r = await c.leads.createWithOutcome("t1", { email: LEAD.email });
    assert.equal(r.created, false);
    assert.equal(r.lead.id, "lead_1");
  });
});

test("createWithOutcome: a response that does not say (older Rello, bare Lead, non-boolean) → created: null, never true", async () => {
  for (const body of [{ success: true, data: { lead: LEAD } }, LEAD, { success: true, data: { lead: LEAD, created: "yes" } }]) {
    await withClient(body, async (c) => {
      const r = await c.leads.createWithOutcome("t1", { email: LEAD.email });
      assert.equal(r.created, null, JSON.stringify(body));
      assert.equal(r.lead.id, "lead_1");
    });
  }
});

test("create (unchanged): still returns the bare Lead", async () => {
  await withClient({ success: true, data: { lead: LEAD, created: false } }, async (c) => {
    const lead = await c.leads.create("t1", { email: LEAD.email });
    assert.equal(lead.id, "lead_1");
    assert.equal("created" in lead, false);
  });
});
