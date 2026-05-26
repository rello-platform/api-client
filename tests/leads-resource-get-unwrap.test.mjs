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

// ── CREATE / UPDATE / GET single-lead ok() envelope unwrap (v2.22.0) ──
// Rello migrated the whole /api/leads* CRUD cluster to ok()/fail():
//   POST  /api/leads      → ok<LeadCreateResponse>({ lead, duplicates? }, {status:201}) → lead at data.lead
//   GET   /api/leads/[id] → ok<LeadDetailGetResponse>(lead, { meta })                   → lead at data
//   PATCH /api/leads/[id] → ok<LeadDetailUpdateResponse>(lead)                          → lead at data
// `unwrapLead` must peel both the envelope AND the optional { lead } nesting,
// while still handling legacy un-enveloped shapes.

function okEnvelope(data, meta) {
  return { success: true, data, ...(meta ? { meta } : {}) };
}

test("LeadsResource.create(): unwraps lead from ok({ lead, duplicates }) envelope", async () => {
  const body = okEnvelope({ lead: FIXTURE_LEAD, duplicates: [{ id: "dup_1" }], warning: "Potential duplicate leads found" });
  await withClient(async () => jsonResponse(body), async (client) => {
    const result = await client.leads.create("tenant_test", { email: FIXTURE_LEAD.email, firstName: "Test" });
    assert.equal(result.id, FIXTURE_LEAD.id, "create must return data.lead.id, not the envelope");
    assert.equal("success" in result, false, "envelope must be fully unwrapped");
    assert.equal("lead" in result, false, "the { lead } nesting must be peeled");
    assert.equal("duplicates" in result, false, "duplicates must not leak onto the Lead");
  });
});

test("LeadsResource.create(): legacy un-enveloped { lead } still unwraps", async () => {
  await withClient(async () => jsonResponse({ lead: FIXTURE_LEAD }), async (client) => {
    const result = await client.leads.create("tenant_test", { email: FIXTURE_LEAD.email });
    assert.equal(result.id, FIXTURE_LEAD.id);
    assert.equal("lead" in result, false);
  });
});

test("LeadsResource.create(): legacy bare-lead response still passes through", async () => {
  await withClient(async () => jsonResponse(FIXTURE_LEAD), async (client) => {
    const result = await client.leads.create("tenant_test", { email: FIXTURE_LEAD.email });
    assert.equal(result.id, FIXTURE_LEAD.id);
  });
});

test("LeadsResource.get(): unwraps lead from canonical ok(lead, { meta }) bare-lead envelope", async () => {
  const body = okEnvelope(FIXTURE_LEAD, { miloStatus: { healthy: true } });
  await withClient(async () => jsonResponse(body), async (client) => {
    const result = await client.leads.get("tenant_test", "lead_test_123");
    assert.equal(result.id, FIXTURE_LEAD.id, "get must return envelope.data (the bare lead)");
    assert.equal("success" in result, false, "envelope must be unwrapped");
    assert.equal("data" in result, false);
  });
});

test("LeadsResource.update(): unwraps lead from canonical ok(lead) bare-lead envelope", async () => {
  await withClient(async () => jsonResponse(okEnvelope(FIXTURE_LEAD)), async (client) => {
    const result = await client.leads.update("tenant_test", "lead_test_123", { firstName: "Renamed" });
    assert.equal(result.id, FIXTURE_LEAD.id, "update must return envelope.data");
    assert.equal("success" in result, false);
  });
});

test("LeadsResource.update(): legacy { lead } envelope still unwraps", async () => {
  await withClient(async () => jsonResponse({ lead: FIXTURE_LEAD }), async (client) => {
    const result = await client.leads.update("tenant_test", "lead_test_123", { firstName: "X" });
    assert.equal(result.id, FIXTURE_LEAD.id);
    assert.equal("lead" in result, false);
  });
});

// ── Audited consumer methods: ok() envelope unwrap (v2.22.0) ──

test("LeadsResource.getConversionScore(): unwraps ok({ score }) to the bare payload", async () => {
  const score = { score: 0.72, factors: { recency: 0.4 }, updatedAt: "2026-05-26T00:00:00Z" };
  await withClient(async () => jsonResponse(okEnvelope({ score })), async (client) => {
    const result = await client.leads.getConversionScore("tenant_test", "lead_test_123");
    assert.equal("success" in result, false, "must return envelope.data, not the envelope");
    assert.deepEqual(result.score, score, "data.score must survive the unwrap intact");
  });
});

test("LeadsResource.getClosedLoans(): unwraps ok({ closedLoans }) array", async () => {
  const closedLoans = [{ id: "ct_1", lender: "Acme", propertyAddress: "1 Main St" }];
  await withClient(async () => jsonResponse(okEnvelope({ closedLoans })), async (client) => {
    const result = await client.leads.getClosedLoans("tenant_test", "lead_test_123");
    assert.equal(Array.isArray(result), true, "must read closedLoans out of envelope.data");
    assert.equal(result[0].id, "ct_1");
  });
});

test("LeadsResource.getClosedLoans(): ok({ closedLoans: null }) → null", async () => {
  await withClient(async () => jsonResponse(okEnvelope({ closedLoans: null })), async (client) => {
    const result = await client.leads.getClosedLoans("tenant_test", "lead_test_123");
    assert.equal(result, null);
  });
});

test("LeadsResource.getClosedLoans(): legacy un-enveloped { closedLoans } still parses", async () => {
  await withClient(async () => jsonResponse({ closedLoans: [{ id: "ct_legacy", propertyAddress: "9 Old Rd" }] }), async (client) => {
    const result = await client.leads.getClosedLoans("tenant_test", "lead_test_123");
    assert.equal(result[0].id, "ct_legacy");
  });
});

test("LeadsResource.getNurtureDecisions(): reads decisions array from envelope.data", async () => {
  const decisions = [{ framework: "ENGAGE", contentDirection: "warm", contentPhase: "early" }];
  await withClient(async () => jsonResponse(okEnvelope(decisions, { total: 1 })), async (client) => {
    const result = await client.leads.getNurtureDecisions("tenant_test", "lead_test_123");
    assert.equal(Array.isArray(result), true);
    assert.equal(result.length, 1);
    assert.equal(result[0].framework, "ENGAGE");
  });
});

test("LeadsResource.getNurtureDecisions(): legacy { decisions } shape still parses", async () => {
  await withClient(async () => jsonResponse({ decisions: [{ framework: "LEGACY", contentDirection: null, contentPhase: null }] }), async (client) => {
    const result = await client.leads.getNurtureDecisions("tenant_test", "lead_test_123");
    assert.equal(result[0].framework, "LEGACY");
  });
});

test("LeadsResource.findByTags(): builds { leads, total } from ok(leads, { meta: { total } })", async () => {
  await withClient(async () => jsonResponse(okEnvelope([FIXTURE_LEAD, FIXTURE_LEAD_2], { total: 42 })), async (client) => {
    const result = await client.leads.findByTags("tenant_test", { tagSlugs: ["hot"], operator: "AND" });
    assert.equal(result.leads.length, 2, "leads must come from envelope.data");
    assert.equal(result.total, 42, "total must come from envelope.meta.total");
  });
});

test("LeadsResource.findByTags(): legacy un-enveloped { leads, total } still parses", async () => {
  await withClient(async () => jsonResponse({ leads: [FIXTURE_LEAD], total: 1 }), async (client) => {
    const result = await client.leads.findByTags("tenant_test", { tagSlugs: ["x"], operator: "OR" });
    assert.equal(result.leads.length, 1);
    assert.equal(result.total, 1);
  });
});

test("LeadsResource.getContextCache(): unwraps ok({ exists, ... }) to the bare payload", async () => {
  const cache = { exists: true, leadId: "lead_test_123", narrative: "story", sourcesPresent: 3, sourcesTotal: 5 };
  await withClient(async () => jsonResponse(okEnvelope(cache)), async (client) => {
    const result = await client.leads.getContextCache("tenant_test", "lead_test_123");
    assert.equal("success" in result, false, "must return envelope.data");
    assert.equal(result.exists, true);
    assert.equal(result.narrative, "story");
  });
});
