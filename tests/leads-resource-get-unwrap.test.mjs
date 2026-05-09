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
