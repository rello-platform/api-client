import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tenantEnablePayloadSchema,
  tenantProvisioningPayloadSchema,
  agentProvisionPayloadSchema,
} from "../dist/index.js";

// PFP Gateway G-6a-pre (spec §G-8 (a) [B8, K-178], amended by KA prompt 1106):
// the provisioned agent gains two OPTIONAL booleans.
//   - hasLinkedUser: the Rello Agent has a linked User (Home Scout's setup message).
//   - isTenantOwner: that User holds an owner role (PathfinderPro's shared rate source).
// provisionedAgentSchema is a plain z.object, which strips unknown keys, and Rello
// sends the PARSED payload, so at v2.30.0 both keys were dropped before the wire.

function agent(over = {}) {
  return {
    relloAgentId: "a1",
    email: "a1@example.com",
    firstName: "A",
    lastName: "One",
    slug: "a-one",
    role: "MLO",
    phone: "8015550100",
    photoUrl: "https://cdn.example.com/a1.png",
    nmlsNumber: "123456",
    mloName: "A One",
    mloNmls: "123456",
    ...over,
  };
}

function payload(agents) {
  return {
    action: "enable",
    relloTenantId: "tenant_1",
    tenant: {
      name: "Acme Lending",
      slug: "acme",
      logoUrl: null,
      primaryColor: "#123456",
      physicalAddress: null,
      applicationUrl: null,
      type: "BROKERAGE",
      plan: "PRO",
    },
    agents,
  };
}

// What tenantEnablePayloadSchema.safeParse returned at v2.30.0 (99948a1) for
// payload([agent(), agent({ relloAgentId: "a2", ..., phone: null })]) — recorded
// from that build's dist, byte for byte.
const PARSED_AT_V2_30_0 = {
  action: "enable",
  relloTenantId: "tenant_1",
  tenant: {
    name: "Acme Lending",
    slug: "acme",
    logoUrl: null,
    primaryColor: "#123456",
    physicalAddress: null,
    applicationUrl: null,
    type: "BROKERAGE",
    plan: "PRO",
  },
  agents: [
    {
      relloAgentId: "a1",
      email: "a1@example.com",
      firstName: "A",
      lastName: "One",
      slug: "a-one",
      role: "MLO",
      phone: "8015550100",
      photoUrl: "https://cdn.example.com/a1.png",
      nmlsNumber: "123456",
      mloName: "A One",
      mloNmls: "123456",
    },
    {
      relloAgentId: "a2",
      email: "a2@example.com",
      firstName: "B",
      lastName: "Two",
      slug: "b-two",
      role: "AGENT",
      phone: null,
      photoUrl: "https://cdn.example.com/a1.png",
      nmlsNumber: "123456",
      mloName: "A One",
      mloNmls: "123456",
    },
  ],
};

const SECOND = { relloAgentId: "a2", email: "a2@example.com", firstName: "B", lastName: "Two", slug: "b-two", role: "AGENT", phone: null };

test("a payload with neither flag parses to exactly what v2.30.0 gave (deep-equal)", () => {
  const r = tenantEnablePayloadSchema.safeParse(payload([agent(), agent(SECOND)]));
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.deepStrictEqual(r.data, PARSED_AT_V2_30_0);
  for (const a of r.data.agents) {
    assert.equal("hasLinkedUser" in a, false);
    assert.equal("isTenantOwner" in a, false);
  }
});

test("hasLinkedUser true and false are kept after parse, not stripped", () => {
  const r = tenantEnablePayloadSchema.safeParse(
    payload([agent({ hasLinkedUser: true }), agent({ ...SECOND, hasLinkedUser: false })]),
  );
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.equal(r.data.agents[0].hasLinkedUser, true);
  assert.equal(r.data.agents[1].hasLinkedUser, false);
});

test("isTenantOwner true and false are kept after parse, not stripped", () => {
  const r = tenantEnablePayloadSchema.safeParse(
    payload([agent({ isTenantOwner: true }), agent({ ...SECOND, isTenantOwner: false })]),
  );
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.equal(r.data.agents[0].isTenantOwner, true);
  assert.equal(r.data.agents[1].isTenantOwner, false);
});

test("both flags together, through the discriminated union a receiver parses with", () => {
  const r = tenantProvisioningPayloadSchema.safeParse(
    payload([
      agent({ hasLinkedUser: true, isTenantOwner: true }),
      agent({ ...SECOND, hasLinkedUser: false, isTenantOwner: false }),
    ]),
  );
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.deepStrictEqual(
    r.data.agents.map((a) => [a.hasLinkedUser, a.isTenantOwner]),
    [
      [true, true],
      [false, false],
    ],
  );
});

test("the agent schema still strips keys it does not name (not made passthrough)", () => {
  const r = tenantEnablePayloadSchema.safeParse(payload([agent({ hasLinkedUser: true, notAField: "x" })]));
  assert.equal(r.success, true);
  assert.equal("notAField" in r.data.agents[0], false);
  assert.equal(r.data.agents[0].hasLinkedUser, true);
});

test("the flags are booleans: a string is refused, as for any typed field", () => {
  assert.equal(tenantEnablePayloadSchema.safeParse(payload([agent({ hasLinkedUser: "true" })])).success, false);
  assert.equal(tenantEnablePayloadSchema.safeParse(payload([agent({ isTenantOwner: "yes" })])).success, false);
});

test("the per-agent provision payload shares the agent schema: the flags are optional there too", () => {
  const base = { action: "add", relloTenantId: "tenant_1", agent: agent() };
  const plain = agentProvisionPayloadSchema.safeParse(base);
  assert.equal(plain.success, true, JSON.stringify(plain.error?.issues));
  assert.equal("hasLinkedUser" in plain.data.agent, false);
  const flagged = agentProvisionPayloadSchema.safeParse({ ...base, agent: agent({ hasLinkedUser: false, isTenantOwner: true }) });
  assert.equal(flagged.success, true);
  assert.equal(flagged.data.agent.hasLinkedUser, false);
  assert.equal(flagged.data.agent.isTenantOwner, true);
});
