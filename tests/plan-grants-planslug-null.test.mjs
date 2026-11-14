import { test } from "node:test";
import assert from "node:assert/strict";
import { tenantEnablePayloadSchema, tenantPlanGrantsSchema } from "../dist/index.js";

// KA ruling G-15 (amendment 1108): a cancelled tenant's plan-grant state is
// grants [] with planSlug null. At v2.30.0 planSlug was z.string(), so Rello's
// push safeParse would refuse the whole enable body. planSlug becomes
// z.string().nullable() and stays a REQUIRED key.

function payload(planGrants) {
  return {
    action: "enable",
    relloTenantId: "tenant_1",
    tenant: { name: "Acme Lending", slug: "acme", logoUrl: null, primaryColor: null, physicalAddress: null, applicationUrl: null, type: "SOLO_MLO", plan: "STARTER" },
    agents: [{ relloAgentId: "a1", email: "a1@example.com", firstName: "A", lastName: "One", slug: "a-one", role: "MLO", phone: null }],
    planGrants,
  };
}

// tenantEnablePayloadSchema.parse(payload({ rev: 4, grants: ["pfp-full", "check-your-rate"], planSlug: "pro" }))
// as v2.30.0 (99948a1) returned it, recorded from that build's dist.
const STRING_PLANSLUG_AT_V2_30_0 = {
  action: "enable",
  relloTenantId: "tenant_1",
  tenant: { name: "Acme Lending", slug: "acme", logoUrl: null, primaryColor: null, physicalAddress: null, applicationUrl: null, type: "SOLO_MLO", plan: "STARTER" },
  agents: [{ relloAgentId: "a1", email: "a1@example.com", firstName: "A", lastName: "One", slug: "a-one", role: "MLO", phone: null }],
  planGrants: { rev: 4, grants: ["pfp-full", "check-your-rate"], planSlug: "pro" },
};

test("a cancelled tenant's grant state (grants [], planSlug null) parses, and planSlug stays null", () => {
  const r = tenantEnablePayloadSchema.safeParse(payload({ rev: 7, grants: [], planSlug: null }));
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.deepStrictEqual(r.data.planGrants, { rev: 7, grants: [], planSlug: null });
});

test("tenantPlanGrantsSchema on its own accepts planSlug null", () => {
  const r = tenantPlanGrantsSchema.safeParse({ rev: 0, grants: [], planSlug: null });
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.equal(r.data.planSlug, null);
});

test("control: a string planSlug parses exactly as at v2.30.0 (deep-equal)", () => {
  const r = tenantEnablePayloadSchema.safeParse(payload({ rev: 4, grants: ["pfp-full", "check-your-rate"], planSlug: "pro" }));
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.deepStrictEqual(r.data, STRING_PLANSLUG_AT_V2_30_0);
});

test("planSlug is still a required key: absent is refused, as at v2.30.0", () => {
  assert.equal(tenantPlanGrantsSchema.safeParse({ rev: 1, grants: [] }).success, false);
});
