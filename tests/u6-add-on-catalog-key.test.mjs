import { test } from "node:test";
import assert from "node:assert/strict";
import * as api from "../dist/index.js";

// PFP Gateway U6 matching (Platform KA prompt 1697): GET /api/v1/billing/add-ons
// carries each row's stable catalog key as `key` (Rello: addOnCatalogKeyOf —
// metadata.catalogKey, else metadata.featureSlug; null when neither). A caller
// matches on key, never on name: a rename in Platform Admin must not hide an add-on.
//
// Three states, never collapsed:
//   a string  — the row's key;
//   null      — Rello answered and the row has no key (unknown, never "");
//   absent    — a Rello that predates the field (the served bodies captured at
//               dd8e6c00c in tests/fixtures still parse). Absent is NOT "no key".
//
// Bodies are the shapes Rello's route answers on real Postgres (Rello branch
// billing/addons-read-catalog-key, route.db.test.ts "each item's catalog key"),
// hand-copied here.

const ok = (schema, body, label) => {
  const r = schema.safeParse(body);
  assert.equal(r.success, true, `${label}: ${JSON.stringify(r.error?.issues)}`);
  return r.data;
};
const bad = (schema, body, label) => assert.equal(schema.safeParse(body).success, false, label);

const ITEM = {
  id: "ao_extra_login",
  appSlug: "pathfinder-pro",
  name: "Extra Team Login",
  key: "extra_team_login",
  type: "RECURRING",
  isActive: true,
  price: { monthly: 1500, yearly: null },
  tenantAddOn: null,
};
const ONCE = {
  id: "ao_lender",
  appSlug: "pathfinder-pro",
  name: "Add a lender",
  key: null,
  type: "ONE_TIME",
  isActive: true,
  price: { monthly: null, yearly: null, once: 24999 },
  tenantAddOn: null,
};
const body = (...addOns) => ({ addOns });

test("a row's key parses and is kept, on both RECURRING and ONE_TIME items", () => {
  const d = ok(api.v1AddOnsReadResponseSchema, body(ITEM, { ...ONCE, key: "add_a_lender" }), "keyed");
  assert.equal(d.addOns[0].key, "extra_team_login");
  assert.equal(d.addOns[1].key, "add_a_lender");
});

test("key null is kept as null: Rello answered and the row has no key", () => {
  const d = ok(api.v1AddOnsReadResponseSchema, body({ ...ITEM, key: null }, ONCE), "null");
  assert.equal(d.addOns[0].key, null);
  assert.equal("key" in d.addOns[0], true, "null is present, never dropped");
  assert.equal(d.addOns[1].key, null);
});

test("a renamed row keeps its key: the same key under a different name", () => {
  const before = ok(api.v1AddOnReadSchema, ITEM, "before");
  const after = ok(api.v1AddOnReadSchema, { ...ITEM, name: "Extra team login" }, "after");
  assert.notEqual(before.name, after.name);
  assert.equal(after.key, "extra_team_login");
  assert.equal(after.key, before.key);
});

test("an item from a Rello that predates the field still parses, and reads as absent, not null", () => {
  const { key: _drop, ...old } = ITEM;
  const d = ok(api.v1AddOnsReadResponseSchema, body(old), "older Rello");
  assert.equal("key" in d.addOns[0], false);
  assert.equal(d.addOns[0].key, undefined);
});

test("an empty or non-string key is refused: unknown is null, never \"\"", () => {
  bad(api.v1AddOnsReadResponseSchema, body({ ...ITEM, key: "" }), "empty string");
  bad(api.v1AddOnsReadResponseSchema, body({ ...ITEM, key: 7 }), "a number");
  bad(api.v1AddOnsReadResponseSchema, body({ ...ONCE, key: "" }), "empty string, ONE_TIME");
});
