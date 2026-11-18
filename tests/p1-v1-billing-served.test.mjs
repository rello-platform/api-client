import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as api from "../dist/index.js";

// PFP Gateway P-1 (Platform KA prompt 1221, rulings 1247/1248/1261): the
// plan-grants read (with cyr), the add-ons read and the add-on POST start,
// parsed against Rello's REAL served bodies. tests/fixtures/rello-v1-billing-
// served-dd8e6c00c.json says where each body came from (real Postgres, Rello's
// own route tests). No body here is hand-written.

const served = JSON.parse(readFileSync(new URL("./fixtures/rello-v1-billing-served-dd8e6c00c.json", import.meta.url), "utf8"));
const ok = (schema, body, label) => {
  assert.ok(schema, `${label}: schema missing from the build`);
  const r = schema.safeParse(body);
  assert.equal(r.success, true, `${label}: ${JSON.stringify(r.error?.issues)}`);
  return r.data;
};
const bad = (schema, body, label) => {
  assert.ok(schema, `${label}: schema missing from the build`);
  assert.equal(schema.safeParse(body).success, false, label);
};

test("plan-grants: every served 200 parses, cyr included, in every status Rello serves", () => {
  const twoHundreds = served.planGrants.filter((r) => r.status === 200);
  assert.ok(twoHundreds.length >= 8, `expected the served 200s, got ${twoHundreds.length}`);
  const statuses = new Set();
  for (const r of twoHundreds) {
    const d = ok(api.planGrantsReadResponseSchema, r.body, r.test);
    statuses.add(d.cyr === null ? "null" : d.cyr.status);
    if (d.cyr) assert.equal(d.cyr.canceledAt, null, `${r.test}: canceledAt is null on this read (ruling 1261)`);
  }
  assert.deepEqual([...statuses].sort(), ["ACTIVE", "CANCELED", "PAST_DUE", "TRIALING", "null"]);
});

test("plan-grants: a served 200 without its cyr key, or with a rounded-string seq, is refused", () => {
  const withCyr = served.planGrants.find((r) => r.status === 200 && r.body.cyr && r.body.cyr.seq > 2 ** 31).body;
  const { cyr, ...noCyr } = withCyr;
  bad(api.planGrantsReadResponseSchema, noCyr, "no cyr key (A-286)");
  bad(api.planGrantsReadResponseSchema, { ...withCyr, cyr: { ...cyr, seq: String(cyr.seq) } }, "seq as a string");
  bad(api.planGrantsReadResponseSchema, { ...withCyr, rev: Number.MAX_SAFE_INTEGER + 2 }, "rev past the safe range");
});

test("plan-grants: the served refusals parse as read refusals, and the tenant 403s as tenant 403s", () => {
  const refusals = served.planGrants.filter((r) => r.status !== 200);
  assert.deepEqual([...new Set(refusals.map((r) => `${r.status}:${r.body.error}`))].sort(), ["404:no_plan_grants", "503:plan_grants_unavailable"]);
  for (const r of refusals) ok(api.planGrantsReadErrorSchema, r.body, r.test);
  const texts = new Set(served.tenantMatch403.map((r) => r.body.error));
  for (const r of served.tenantMatch403) ok(api.v1TenantMatchErrorSchema, r.body, r.test);
  assert.ok(texts.has(api.V1_TENANT_MATCH_ERRORS.tenantHeaderMismatch));
  assert.ok(texts.has(api.V1_TENANT_MATCH_ERRORS.callerAppNotAllowed));
  assert.ok(texts.has(api.appNotEnabledForTenantError("pathfinder-pro")));
});

test("add-ons: the served 200s parse; price cents or null; quantityRev an exact decimal string", () => {
  const twoHundreds = served.addOns.filter((r) => r.status === 200);
  assert.ok(twoHundreds.length >= 3);
  let sawNull = false, sawZero = false, sawBigRev = false;
  for (const r of twoHundreds) {
    const d = ok(api.v1AddOnsReadResponseSchema, r.body, r.test);
    for (const a of d.addOns) {
      if (a.price.monthly === null) sawNull = true;
      if (a.price.monthly === 0) sawZero = true;
      const rev = a.tenantAddOn?.quantityRev;
      if (rev && BigInt(rev) > BigInt(Number.MAX_SAFE_INTEGER)) sawBigRev = true;
    }
  }
  assert.ok(sawNull && sawZero && sawBigRev, "served bodies cover unknown price, a real 0, and a rev past MAX_SAFE");
});

test("add-ons: a quantityRev sent as a number, a price as dollars, or a missing tenantAddOn key is refused", () => {
  const body = served.addOns.find((r) => r.status === 200 && r.body.addOns.some((a) => a.tenantAddOn)).body;
  const i = body.addOns.findIndex((a) => a.tenantAddOn);
  const at = (patch) => ({ addOns: body.addOns.map((a, j) => (j === i ? patch(a) : a)) });
  bad(api.v1AddOnsReadResponseSchema, at((a) => ({ ...a, tenantAddOn: { ...a.tenantAddOn, quantityRev: 41 } })), "rev as number");
  bad(api.v1AddOnsReadResponseSchema, at((a) => ({ ...a, price: { monthly: 29.99, yearly: null } })), "dollars, not cents");
  bad(api.v1AddOnsReadResponseSchema, at((a) => { const { tenantAddOn, ...rest } = a; return rest; }), "tenantAddOn key missing");
  const refusal = served.addOns.find((r) => r.status === 503);
  ok(api.addOnsReadErrorSchema, refusal.body, refusal.test);
  assert.deepEqual([...api.ADD_ONS_READ_ERROR_CODES], ["add_ons_unavailable"]);
});

test("add-on start: served 200s parse (with and without trialEndsAt); refusals parse with their codes", () => {
  assert.equal(api.ADD_ON_START_IDEMPOTENCY_HEADER, "X-Idempotency-Key");
  const rows = served.addOnStart;
  for (const r of rows.filter((x) => x.status === 200)) ok(api.addOnStartResponseSchema, r.body, r.test);
  for (const r of rows.filter((x) => x.status !== 200)) {
    if (r.body.success === false) {
      const d = ok(api.addOnStartErrorSchema, r.body, r.test);
      if (d.code) assert.ok(api.ADD_ON_START_ERROR_CODES.includes(d.code), `${d.code} is a known start code`);
      if (d.code === "already_entitled") assert.equal(d.coveredSeats, 1, ".loose() keeps the code's fields");
    } else {
      ok(api.v1TenantMatchErrorSchema, r.body, r.test);
    }
  }
  assert.ok(rows.some((r) => r.status === 402 && r.body.code === "payment_method_required"));
});

test("add-on start: the request is strict; quantityRev a number or an 18-digit decimal string", () => {
  ok(api.addOnStartRequestSchema, { addOnId: "a1" }, "minimal");
  ok(api.addOnStartRequestSchema, { addOnId: "a1", quantity: 2, trial: true, quantityRev: "123456789012345678" }, "full");
  bad(api.addOnStartRequestSchema, { addOnId: "a1", coupon: "FREE" }, "a coupon is refused");
  bad(api.addOnStartRequestSchema, { addOnId: "a1", quantityRev: "1234567890123456789" }, "19 digits");
  bad(api.addOnStartRequestSchema, { addOnId: "a1", quantity: 0 }, "quantity 0");
});
