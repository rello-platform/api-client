import { test } from "node:test";
import assert from "node:assert/strict";
import { createRelloClient } from "../dist/index.js";

const FIXTURE_LEAD = {
  id: "lead_test_123",
  email: "buyer@example.com",
  firstName: "Test",
  lastName: "Buyer",
  tenantId: "tenant_test",
};

function withClient(fetchImpl, fn) {
  const prevFetch = globalThis.fetch;
  const prevUrl = process.env.RELLO_API_URL;
  const prevKey = process.env.RELLO_API_KEY;
  const prevSlug = process.env.APP_SLUG;
  globalThis.fetch = fetchImpl;
  process.env.RELLO_API_URL = "https://test.invalid";
  process.env.RELLO_API_KEY = "test-key";
  process.env.APP_SLUG = "test-spoke";
  try {
    const client = createRelloClient();
    return fn(client);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevUrl === undefined) delete process.env.RELLO_API_URL; else process.env.RELLO_API_URL = prevUrl;
    if (prevKey === undefined) delete process.env.RELLO_API_KEY; else process.env.RELLO_API_KEY = prevKey;
    if (prevSlug === undefined) delete process.env.APP_SLUG; else process.env.APP_SLUG = prevSlug;
  }
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("LeadsResource.get(): returns plain Lead when server returns plain Lead", async () => {
  await withClient(async () => jsonResponse(FIXTURE_LEAD), async (client) => {
    const result = await client.leads.get("tenant_test", "lead_test_123");
    assert.equal(result.id, FIXTURE_LEAD.id);
    assert.equal(result.email, FIXTURE_LEAD.email);
    assert.equal(result.firstName, FIXTURE_LEAD.firstName);
    assert.equal("lead" in result, false, "result must NOT have a `lead` property — should be the Lead itself, not the envelope");
  });
});

test("LeadsResource.get(): unwraps Lead when server returns { lead, miloStatus } envelope", async () => {
  const envelope = { lead: FIXTURE_LEAD, miloStatus: { healthy: true, lastEvalAt: "2026-05-09T00:00:00Z" } };
  await withClient(async () => jsonResponse(envelope), async (client) => {
    const result = await client.leads.get("tenant_test", "lead_test_123");
    assert.equal(result.id, FIXTURE_LEAD.id);
    assert.equal(result.email, FIXTURE_LEAD.email);
    assert.equal(result.firstName, FIXTURE_LEAD.firstName);
    assert.equal("lead" in result, false, "envelope must be unwrapped — result must NOT contain a `lead` key");
    assert.equal("miloStatus" in result, false, "miloStatus must not leak through onto the unwrapped Lead");
  });
});

test("LeadsResource.get(): unwraps Lead when envelope has only { lead } (no miloStatus)", async () => {
  const envelope = { lead: FIXTURE_LEAD };
  await withClient(async () => jsonResponse(envelope), async (client) => {
    const result = await client.leads.get("tenant_test", "lead_test_123");
    assert.equal(result.id, FIXTURE_LEAD.id);
    assert.equal("lead" in result, false);
  });
});

// ── LIST / LIST-WITH-PAGINATION / FIND-BY-EMAIL envelope parsing ──
// Rello's GET /api/leads returns ok<T>(result.leads, { meta }) =
// { success, data, meta:{ total, page, totalPages, pageSize } }. The lead
// array is `data`; pagination is under `meta`. (CR-2 fix — v2.20.0.)

const FIXTURE_LEAD_2 = {
  id: "lead_test_456",
  email: "second@example.com",
  firstName: "Second",
  lastName: "Lead",
  tenantId: "tenant_test",
};

function canonicalLeadsEnvelope(leads, metaOverrides = {}) {
  return {
    success: true,
    data: leads,
    meta: { total: leads.length, page: 1, totalPages: 1, pageSize: leads.length, ...metaOverrides },
  };
}

test("LeadsResource.listWithPagination(): reads leads from .data and pagination from .meta", async () => {
  const body = canonicalLeadsEnvelope([FIXTURE_LEAD, FIXTURE_LEAD_2], { total: 89, page: 1, totalPages: 30, pageSize: 2 });
  await withClient(async () => jsonResponse(body), async (client) => {
    const page = await client.leads.listWithPagination("tenant_test", { search: "an", limit: 2 });
    assert.equal(Array.isArray(page.leads), true);
    assert.equal(page.leads.length, 2, "leads must come from envelope.data");
    assert.equal(page.leads[0].id, FIXTURE_LEAD.id);
    assert.equal(page.total, 89, "total must come from envelope.meta.total");
    assert.equal(page.page, 1);
    assert.equal(page.totalPages, 30, "totalPages must come from envelope.meta.totalPages");
  });
});

test("LeadsResource.list(): returns the Lead[] from envelope.data", async () => {
  const body = canonicalLeadsEnvelope([FIXTURE_LEAD, FIXTURE_LEAD_2], { total: 2 });
  await withClient(async () => jsonResponse(body), async (client) => {
    const leads = await client.leads.list("tenant_test", { search: "e" });
    assert.equal(Array.isArray(leads), true, "list() must return an array, not undefined");
    assert.equal(leads.length, 2);
    assert.equal(leads[1].email, FIXTURE_LEAD_2.email);
  });
});

test("LeadsResource.list(): empty result → empty array (not undefined)", async () => {
  const body = canonicalLeadsEnvelope([], { total: 0, totalPages: 0 });
  await withClient(async () => jsonResponse(body), async (client) => {
    const leads = await client.leads.list("tenant_test", { search: "zzzznomatch" });
    assert.equal(Array.isArray(leads), true);
    assert.equal(leads.length, 0);
  });
});

test("LeadsResource.findByEmail(): finds the lead inside the { success, data, meta } envelope", async () => {
  const body = canonicalLeadsEnvelope([FIXTURE_LEAD], { total: 1 });
  await withClient(async () => jsonResponse(body), async (client) => {
    const lead = await client.leads.findByEmail("tenant_test", "buyer@example.com");
    assert.notEqual(lead, null, "findByEmail must locate the lead in envelope.data (dedup-critical)");
    assert.equal(lead.id, FIXTURE_LEAD.id);
  });
});

test("LeadsResource.listWithPagination(): legacy un-enveloped { leads, total } shape still parses", async () => {
  const legacy = { leads: [FIXTURE_LEAD], total: 7, page: 1, totalPages: 7 };
  await withClient(async () => jsonResponse(legacy), async (client) => {
    const page = await client.leads.listWithPagination("tenant_test", { search: "x" });
    assert.equal(page.leads.length, 1, "legacy top-level .leads must still be read via fallback");
    assert.equal(page.total, 7, "legacy top-level .total must still be read via fallback");
  });
});
