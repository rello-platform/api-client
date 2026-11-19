import { test } from "node:test";
import assert from "node:assert/strict";
import * as api from "../dist/index.js";

// PFP Gateway G-LR Part B (Platform KA prompts 1323 / 1329): GET
// /api/v1/billing/add-ons carries a ONE_TIME add-on's one-time price as
// `price.once` (integer cents, null only when none is set). A RECURRING
// add-on's item is unchanged and has no `once` key.
//
// The bodies below are the shapes Rello's route answers on real Postgres
// (Rello branch a5/glr-partb-billing-read-1323, route.db.test.ts "a ONE_TIME
// add-on with a one-time price set carries it in cents as price.once" and the
// byte-identical RECURRING test), hand-copied here.

const ok = (schema, body, label) => {
  const r = schema.safeParse(body);
  assert.equal(r.success, true, `${label}: ${JSON.stringify(r.error?.issues)}`);
  return r.data;
};
const bad = (schema, body, label) => assert.equal(schema.safeParse(body).success, false, label);

const ONE_TIME = {
  id: "ao_lender",
  appSlug: "pathfinder-pro",
  name: "Add a lender",
  type: "ONE_TIME",
  isActive: true,
  price: { monthly: null, yearly: null, once: 24999 },
  tenantAddOn: null,
};
const RECURRING = {
  id: "ao_cyr",
  appSlug: "pathfinder-pro",
  name: "Check Your Rate",
  type: "RECURRING",
  isActive: true,
  price: { monthly: 2999, yearly: 29900 },
  tenantAddOn: null,
};
const body = (...addOns) => ({ addOns });
const oneTime = (price) => ({ ...ONE_TIME, price });

test("a ONE_TIME add-on's one-time price parses and is kept, in cents", () => {
  const d = ok(api.v1AddOnsReadResponseSchema, body(ONE_TIME, RECURRING), "one-time + recurring");
  assert.deepEqual(d.addOns[0].price, { monthly: null, yearly: null, once: 24999 });
  const one = ok(api.v1AddOnReadSchema, ONE_TIME, "item");
  assert.equal(one.price.once, 24999);
});

test("a ONE_TIME add-on with no one-time price set parses with once: null; a determined 0 is kept", () => {
  const d = ok(api.v1AddOnsReadResponseSchema, body(oneTime({ monthly: null, yearly: null, once: null })), "unset");
  assert.equal(d.addOns[0].price.once, null);
  const z = ok(api.v1AddOnsReadResponseSchema, body(oneTime({ monthly: null, yearly: null, once: 0 })), "zero");
  assert.equal(z.addOns[0].price.once, 0);
});

test("a ONE_TIME body without `once`, in dollars, negative, or with a per-interval price is refused", () => {
  bad(api.v1AddOnsReadResponseSchema, body(oneTime({ monthly: null, yearly: null })), "once missing: unknown is null, never absent");
  bad(api.v1AddOnsReadResponseSchema, body(oneTime({ monthly: null, yearly: null, once: 249.99 })), "dollars, not cents");
  bad(api.v1AddOnsReadResponseSchema, body(oneTime({ monthly: null, yearly: null, once: -1 })), "negative");
  bad(api.v1AddOnsReadResponseSchema, body(oneTime({ monthly: null, yearly: null, once: "24999" })), "a string");
  bad(api.v1AddOnsReadResponseSchema, body(oneTime({ monthly: 24999, yearly: null, once: 24999 })), "a one-time add-on has no monthly price");
});

test("a RECURRING add-on is unchanged: { monthly, yearly } parses as before and carries no `once`", () => {
  const d = ok(api.v1AddOnsReadResponseSchema, body(RECURRING), "recurring");
  assert.deepEqual(d.addOns[0].price, { monthly: 2999, yearly: 29900 });
  assert.equal("once" in d.addOns[0].price, false);
  ok(api.addOnUnitPriceSchema, { monthly: null, yearly: null }, "the per-interval schema is unchanged");
  bad(api.v1AddOnsReadResponseSchema, body({ ...RECURRING, price: { monthly: 29.99, yearly: null } }), "dollars, not cents");
});

test("the one-time price schema is exported for callers", () => {
  ok(api.addOnOneTimePriceSchema, { monthly: null, yearly: null, once: 9900 }, "exported");
});
