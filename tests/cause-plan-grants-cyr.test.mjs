import { test } from "node:test";
import assert from "node:assert/strict";
import { tenantEnablePayloadSchema, tenantPlanGrantsSchema, tenantCyrStateSchema } from "../dist/index.js";

// KA amendment 1109 (PFP Gateway KA, A-275): a removal caused by a plan switch
// carries cause "plan_change" on BOTH the plan-grant push and the cyr add-on
// block, so PFP can keep a plan-switched source on briefly and turn any other
// removal off at once. A plain string, never an enum: a later cause value must
// not make an older receiver refuse the whole push.

function payload(extra) {
  return {
    action: "enable",
    relloTenantId: "tenant_1",
    tenant: { name: "Acme Lending", slug: "acme", logoUrl: null, primaryColor: null, physicalAddress: null, applicationUrl: null, type: "SOLO_MLO", plan: "STARTER" },
    agents: [{ relloAgentId: "a1", email: "a1@example.com", firstName: "A", lastName: "One", slug: "a-one", role: "MLO", phone: null }],
    ...extra,
  };
}

const GRANTS = { rev: 5, grants: ["pfp-full"], planSlug: "starter" };
const CYR = {
  featureSlug: "check-your-rate",
  status: "CANCELED",
  quantity: 0,
  trialEndsAt: null,
  canceledAt: "2026-11-14T18:00:00.000Z",
  occurredAt: "2026-11-14T18:00:00.123Z",
  seq: 9,
  source: "addon",
};

// tenantEnablePayloadSchema.parse(payload({ planGrants: GRANTS, cyr: { ...CYR, previousStatus: "ACTIVE",
// addOnId: "ao_1", tenantAddOnId: "tao_1" } })) as v2.30.0 (99948a1) returned it.
const NO_CAUSE_AT_V2_30_0 = {
  action: "enable",
  relloTenantId: "tenant_1",
  tenant: { name: "Acme Lending", slug: "acme", logoUrl: null, primaryColor: null, physicalAddress: null, applicationUrl: null, type: "SOLO_MLO", plan: "STARTER" },
  agents: [{ relloAgentId: "a1", email: "a1@example.com", firstName: "A", lastName: "One", slug: "a-one", role: "MLO", phone: null }],
  planGrants: { rev: 5, grants: ["pfp-full"], planSlug: "starter" },
  cyr: {
    featureSlug: "check-your-rate",
    status: "CANCELED",
    quantity: 0,
    trialEndsAt: null,
    canceledAt: "2026-11-14T18:00:00.000Z",
    occurredAt: "2026-11-14T18:00:00.123Z",
    seq: 9,
    source: "addon",
  },
};

const EXTRAS = { previousStatus: "ACTIVE", addOnId: "ao_1", tenantAddOnId: "tao_1" };

test("without cause, planGrants and cyr parse exactly as at v2.30.0 (the three other extras still dropped)", () => {
  const r = tenantEnablePayloadSchema.safeParse(payload({ planGrants: GRANTS, cyr: { ...CYR, ...EXTRAS } }));
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.deepStrictEqual(r.data, NO_CAUSE_AT_V2_30_0);
});

test("planGrants keeps cause \"plan_change\" through the enable payload", () => {
  const r = tenantEnablePayloadSchema.safeParse(payload({ planGrants: { ...GRANTS, grants: [], cause: "plan_change" } }));
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.equal(r.data.planGrants.cause, "plan_change");
});

test("the cyr block keeps cause \"plan_change\"; previousStatus, addOnId and tenantAddOnId are still dropped", () => {
  const r = tenantEnablePayloadSchema.safeParse(payload({ cyr: { ...CYR, ...EXTRAS, cause: "plan_change" } }));
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.equal(r.data.cyr.cause, "plan_change");
  for (const k of Object.keys(EXTRAS)) assert.equal(k in r.data.cyr, false, k);
});

test("cause is a plain string on both: a later value is accepted, never a refused push", () => {
  const g = tenantPlanGrantsSchema.safeParse({ ...GRANTS, cause: "a_cause_added_later" });
  const c = tenantCyrStateSchema.safeParse({ ...CYR, cause: "a_cause_added_later" });
  assert.equal(g.success, true, JSON.stringify(g.error?.issues));
  assert.equal(c.success, true, JSON.stringify(c.error?.issues));
  assert.equal(g.data.cause, "a_cause_added_later");
  assert.equal(c.data.cause, "a_cause_added_later");
});
