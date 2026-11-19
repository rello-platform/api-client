import { test } from "node:test";
import assert from "node:assert/strict";
import * as api from "../dist/index.js";
import { createRelloClient, RelloError, RelloNotFoundError, RelloValidationError, RelloUnavailableError } from "../dist/index.js";

// Platform KA prompt 1440 (ruling 1439): four more named refusals of
//   POST/GET /api/v1/billing/add-on/charge-once
// that Rello's route (Rello PR #2519) answers and the v2.40.0 code list did not name:
//   422 { error: "request_id_in_use" }      one request id reused for a different add-on; nothing charged
//   409 { error: "request_id_ambiguous" }   GET only, a rare race
//   503 { error: "billing_unavailable" }    Stripe not configured; nothing claimed
//   409 { error: "add_on_not_priced" }      a ONE_TIME add-on with no one-time price
// The client maps statuses the way every existing method does (no new error class): 4xx is thrown
// at once as RelloError with the body kept, 5xx is retried and then thrown. These tests pin that,
// and that each code is in ADD_ON_CHARGE_ONCE_ERROR_CODES, which is what PFP compares against.

const NEW_CODES = ["request_id_in_use", "request_id_ambiguous", "billing_unavailable", "add_on_not_priced"];
const OLD_CODES = ["price_changed", "add_on_not_one_time", "add_on_not_found"];

function withClient(fetchImpl, fn) {
  const prev = { f: globalThis.fetch, u: process.env.RELLO_API_URL, k: process.env.RELLO_API_KEY, s: process.env.APP_SLUG };
  globalThis.fetch = fetchImpl;
  process.env.RELLO_API_URL = "https://test.invalid";
  process.env.RELLO_API_KEY = "test-key";
  process.env.APP_SLUG = "pathfinder-pro";
  const restore = () => {
    globalThis.fetch = prev.f;
    for (const [k, v] of [["RELLO_API_URL", prev.u], ["RELLO_API_KEY", prev.k], ["APP_SLUG", prev.s]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };
  return Promise.resolve().then(() => fn(createRelloClient())).finally(restore);
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const REQ = { addOnId: "ao_1", quoteCents: 9900 };
const KEY = "pfp-req-0001";

// The refusal a caller sees: a plain RelloError (not one of the specialised classes), the status, and the
// body with the named code that is in the exported list.
function isPlainRefusal(e, status, code) {
  assert.ok(e instanceof RelloError, "is a RelloError");
  assert.equal(e.constructor, RelloError, `plain RelloError, not ${e.constructor.name}`);
  assert.equal(e.statusCode, status);
  const body = api.addOnChargeOnceErrorSchema.safeParse(e.body);
  assert.equal(body.success, true, "body parses with the error schema");
  assert.equal(body.data.error, code);
  assert.ok(api.ADD_ON_CHARGE_ONCE_ERROR_CODES.includes(body.data.error), `${code} is in ADD_ON_CHARGE_ONCE_ERROR_CODES`);
  return true;
}

test("code list: the three v2.40.0 codes stay and the four new ones are added, nothing else; every code parses", () => {
  const list = [...api.ADD_ON_CHARGE_ONCE_ERROR_CODES];
  assert.deepEqual([...list].sort(), [...OLD_CODES, ...NEW_CODES].sort());
  assert.equal(new Set(list).size, list.length, "no duplicate");
  for (const code of list) {
    assert.equal(api.addOnChargeOnceErrorSchema.safeParse({ error: code }).success, true, code);
    assert.equal(typeof code, "string");
  }
});

test("POST 422 request_id_in_use: thrown at once as a plain RelloError 422 with the body, never retried, never an answer", async () => {
  let calls = 0;
  await withClient(async () => { calls++; return json(422, { error: "request_id_in_use" }); }, async (client) => {
    await assert.rejects(client.billing.chargeOneTimeAddOn("tenant_1", REQ, KEY), (e) => isPlainRefusal(e, 422, "request_id_in_use"));
  });
  assert.equal(calls, 1, "a 4xx is not retried");
});

test("GET 409 request_id_ambiguous: thrown at once as a plain RelloError 409 with the body, never retried", async () => {
  let calls = 0;
  let url = "";
  await withClient(async (u) => { calls++; url = String(u); return json(409, { error: "request_id_ambiguous" }); }, async (client) => {
    await assert.rejects(client.billing.getOneTimeAddOnCharge("tenant_1", KEY), (e) => isPlainRefusal(e, 409, "request_id_ambiguous"));
  });
  assert.equal(calls, 1);
  assert.ok(url.includes("requestId=pfp-req-0001"), url);
});

test("POST 409 add_on_not_priced: thrown at once as a plain RelloError 409 with the body, distinct from price_changed", async () => {
  let calls = 0;
  await withClient(async () => { calls++; return json(409, { error: "add_on_not_priced" }); }, async (client) => {
    await assert.rejects(client.billing.chargeOneTimeAddOn("tenant_1", REQ, KEY), (e) => isPlainRefusal(e, 409, "add_on_not_priced") && e.body.error !== "price_changed");
  });
  assert.equal(calls, 1);
});

test("POST 503 billing_unavailable: retried on the same idempotency key, then thrown as a RelloError 503 with the body (the existing 5xx path)", async () => {
  const seen = [];
  await withClient(async (_u, init) => { seen.push(init.headers); return json(503, { error: "billing_unavailable" }); }, async (client) => {
    await assert.rejects(client.billing.chargeOneTimeAddOn("tenant_1", REQ, KEY), (e) => {
      assert.ok(!(e instanceof RelloValidationError) && !(e instanceof RelloNotFoundError), "not a 4xx class");
      assert.ok(!(e instanceof RelloUnavailableError), "RelloUnavailableError is for network failures and an open breaker, not a read answer");
      return isPlainRefusal(e, 503, "billing_unavailable");
    });
  });
  assert.equal(seen.length, 3, "the transport's three attempts");
  for (const h of seen) {
    assert.equal(h["X-Idempotency-Key"], KEY, "same key on every attempt: a retry is the same charge");
    assert.equal(h["Idempotency-Key"], KEY);
  }
});

test("a refusal body that is not one of the named codes still throws with its body (a later code never turns into an answer)", async () => {
  await withClient(async () => json(409, { error: "some_later_code" }), async (client) => {
    await assert.rejects(client.billing.chargeOneTimeAddOn("tenant_1", REQ, KEY), (e) => {
      assert.equal(e.statusCode, 409);
      assert.equal(e.body.error, "some_later_code");
      assert.equal(api.ADD_ON_CHARGE_ONCE_ERROR_CODES.includes(e.body.error), false);
      return true;
    });
  });
});
