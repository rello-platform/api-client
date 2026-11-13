import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tenantEnablePayloadSchema,
  tenantProvisioningPayloadSchema,
  tenantPlanGrantsSchema,
  tenantCyrStateSchema,
} from "../dist/index.js";

// PFP Gateway G-2 (spec §4.2, §4.3 [A-14], A-195): the enable payload gains
// tenant.billingOrigin, planGrants and cyr, all optional so an older sender
// still parses; and phone / logoUrl may be absent, as Rello's push now sends them.

function basePayload() {
  return {
    action: "enable",
    relloTenantId: "tenant_1",
    tenant: {
      name: "Acme Lending",
      slug: "acme",
      logoUrl: null,
      primaryColor: null,
      physicalAddress: null,
      applicationUrl: null,
      type: "SOLO_MLO",
      plan: "STARTER",
    },
    agents: [
      { relloAgentId: "a1", email: "a1@example.com", firstName: "A", lastName: "One", slug: "a-one", role: "MLO", phone: null },
    ],
  };
}

const GRANTS = { rev: 1, grants: ["pfp-rates"], planSlug: "pfp-rates" };
const CYR = {
  status: "TRIALING",
  quantity: 1,
  trialEndsAt: "2026-12-01T00:00:00.000Z",
  canceledAt: null,
  occurredAt: "2026-11-13T22:00:00.123Z",
  seq: 3,
  source: "plan",
};

test("an older sender's payload (none of the new fields) still parses, unchanged", () => {
  const r = tenantEnablePayloadSchema.safeParse(basePayload());
  assert.equal(r.success, true);
  assert.equal("planGrants" in r.data, false);
  assert.equal("cyr" in r.data, false);
  assert.equal("billingOrigin" in r.data.tenant, false);
});

test("billingOrigin, planGrants and cyr are kept, not stripped", () => {
  const p = basePayload();
  p.tenant.billingOrigin = "pfp-gateway";
  p.planGrants = GRANTS;
  p.cyr = CYR;
  const r = tenantEnablePayloadSchema.safeParse(p);
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.equal(r.data.tenant.billingOrigin, "pfp-gateway");
  assert.deepEqual(r.data.planGrants, GRANTS);
  assert.deepEqual(r.data.cyr, CYR);
});

test("the discriminated union keeps them too", () => {
  const p = { ...basePayload(), planGrants: GRANTS, cyr: CYR };
  const r = tenantProvisioningPayloadSchema.safeParse(p);
  assert.equal(r.success, true);
  assert.deepEqual(r.data.planGrants, GRANTS);
  assert.deepEqual(r.data.cyr, CYR);
});

test("null is accepted for each: a non-gateway tenant, no grant state, never held CYR", () => {
  const p = basePayload();
  p.tenant.billingOrigin = null;
  p.planGrants = null;
  p.cyr = null;
  const r = tenantEnablePayloadSchema.safeParse(p);
  assert.equal(r.success, true);
  assert.equal(r.data.tenant.billingOrigin, null);
  assert.equal(r.data.planGrants, null);
  assert.equal(r.data.cyr, null);
});

test("A-195: an absent phone and an absent tenant logo parse (Rello's push omits empties)", () => {
  const p = basePayload();
  delete p.tenant.logoUrl;
  delete p.agents[0].phone;
  const r = tenantEnablePayloadSchema.safeParse(p);
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.equal("logoUrl" in r.data.tenant, false);
  assert.equal("phone" in r.data.agents[0], false);
});

test("a phone and logo that exist still come through", () => {
  const p = basePayload();
  p.tenant.logoUrl = "https://cdn.example.com/logo.png";
  p.agents[0].phone = "+18015550100";
  const r = tenantEnablePayloadSchema.safeParse(p);
  assert.equal(r.success, true);
  assert.equal(r.data.tenant.logoUrl, "https://cdn.example.com/logo.png");
  assert.equal(r.data.agents[0].phone, "+18015550100");
});

test("planGrants refuses a malformed record", () => {
  for (const bad of [
    { ...GRANTS, rev: -1 },
    { ...GRANTS, rev: 1.5 },
    { ...GRANTS, rev: "1" },
    { ...GRANTS, grants: "pfp-rates" },
    { ...GRANTS, grants: [1] },
    { rev: 1, grants: [] },
  ]) {
    assert.equal(tenantPlanGrantsSchema.safeParse(bad).success, false, JSON.stringify(bad));
    assert.equal(tenantEnablePayloadSchema.safeParse({ ...basePayload(), planGrants: bad }).success, false);
  }
  // An unknown feature slug is kept: a receiver on an older slugs release still parses.
  assert.equal(tenantPlanGrantsSchema.safeParse({ ...GRANTS, grants: ["pfp-future"] }).success, true);
  assert.equal(tenantPlanGrantsSchema.safeParse({ ...GRANTS, grants: [] }).success, true);
});

test("cyr refuses a malformed record", () => {
  for (const bad of [
    { ...CYR, status: "none" },
    { ...CYR, status: "ADDED" },
    { ...CYR, quantity: -1 },
    { ...CYR, seq: 2.5 },
    { ...CYR, seq: "3" },
    { ...CYR, source: "stripe" },
    { ...CYR, occurredAt: undefined },
    (() => { const { trialEndsAt, ...rest } = CYR; return rest; })(),
  ]) {
    assert.equal(tenantCyrStateSchema.safeParse(bad).success, false, JSON.stringify(bad));
    assert.equal(tenantEnablePayloadSchema.safeParse({ ...basePayload(), cyr: bad }).success, false);
  }
  for (const status of ["ACTIVE", "TRIALING", "PAST_DUE", "CANCELED"]) {
    assert.equal(tenantCyrStateSchema.safeParse({ ...CYR, status }).success, true);
  }
});
