import { test } from "node:test";
import assert from "node:assert/strict";
import { tenantEnablePayloadSchema } from "../dist/index.js";
import { HUB_DOMAINS } from "@rello-platform/slugs";

// Home Insight HI-21 (spec RELLO-HOME-INSIGHT §9, X-34, L-2): Rello's tenant push
// returns tenantEnablePayloadSchema.safeParse(payload).data (Rello
// src/lib/tenants/spoke-provisioning.ts:305-314). `tenant` is a plain z.object,
// so at v2.48.0 a `tenant.hubDomain` key is stripped and never reaches a spoke.
// It is now `z.enum(HUB_DOMAINS).optional()`, HUB_DOMAINS from @rello-platform/slugs.

function payload(tenantExtra) {
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
      ...tenantExtra,
    },
    agents: [{ relloAgentId: "a1", email: "a1@example.com", firstName: "A", lastName: "One", slug: "a-one", role: "MLO", phone: null }],
  };
}

test("tenant.hubDomain HOMEINSIGHT parses and is kept (stripped at v2.48.0)", () => {
  const r = tenantEnablePayloadSchema.safeParse(payload({ hubDomain: "HOMEINSIGHT" }));
  assert.equal(r.success, true);
  assert.equal(r.data.tenant.hubDomain, "HOMEINSIGHT");
});

test("every HUB_DOMAINS value parses and is kept (the enum is slugs' list, not a copy)", () => {
  assert.ok(HUB_DOMAINS.length >= 2);
  for (const d of HUB_DOMAINS) {
    const r = tenantEnablePayloadSchema.safeParse(payload({ hubDomain: d }));
    assert.equal(r.success, true, d);
    assert.equal(r.data.tenant.hubDomain, d);
  }
});

test("absent hubDomain stays absent (an older Rello is unknown, never a default)", () => {
  const r = tenantEnablePayloadSchema.safeParse(payload({}));
  assert.equal(r.success, true);
  assert.equal("hubDomain" in r.data.tenant, false);
});

test("an unknown hubDomain value is refused", () => {
  for (const bad of ["homeinsight", "OTHER", "", null, 1]) {
    const r = tenantEnablePayloadSchema.safeParse(payload({ hubDomain: bad }));
    assert.equal(r.success, false, `hubDomain ${JSON.stringify(bad)} should be refused`);
  }
});
