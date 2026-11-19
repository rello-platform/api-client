import { test } from "node:test";
import assert from "node:assert/strict";
import * as api from "../dist/index.js";
import { createRelloClient, RelloError, RelloNotFoundError, RelloValidationError } from "../dist/index.js";

// PFP Gateway "Match my design" (Platform KA prompt 1419; Kelly D55): the contract of
//   POST /api/v1/billing/add-on/charge-once   header X-Idempotency-Key (8-128), body { addOnId, quoteCents }
//   GET  /api/v1/billing/add-on/charge-once?requestId=<id>
// permission billing:addon-charge:write (@rello-platform/permissions v0.66.0).

const ISO = "2026-11-19T22:30:00.000Z";
const CHARGED = { status: "charged", chargeId: "chg_1", amountCents: 9900, paidAt: ISO };
const DECLINED = { status: "declined", message: "Your card was declined." };
const UNKNOWN = { status: "unknown", chargeId: "chg_2" };
const MANUAL_A = { status: "manual", reason: "no_stripe_customer" };
const MANUAL_B = { status: "manual", reason: "no_payment_method" };

test("answer schema: each of the four answers parses and keeps its fields", () => {
  const s = api.addOnChargeOnceAnswerSchema;
  assert.ok(s, "addOnChargeOnceAnswerSchema missing");
  for (const body of [CHARGED, DECLINED, UNKNOWN, MANUAL_A, MANUAL_B]) {
    const r = s.safeParse(body);
    assert.equal(r.success, true, JSON.stringify(r.error?.issues));
    assert.deepEqual(r.data, body);
  }
});

test("answer schema: a wrong status, a missing field, a bad reason or non-integer cents is refused", () => {
  const s = api.addOnChargeOnceAnswerSchema;
  assert.equal(s.safeParse({ ...CHARGED, status: "paid" }).success, false, "wrong status");
  assert.equal(s.safeParse({ status: "charged" }).success, false, "charged with no fields");
  assert.equal(s.safeParse({ ...CHARGED, amountCents: 99.5 }).success, false, "fractional cents");
  assert.equal(s.safeParse({ ...CHARGED, amountCents: "9900" }).success, false, "cents as a string");
  assert.equal(s.safeParse({ ...CHARGED, amountCents: -1 }).success, false, "negative cents");
  assert.equal(s.safeParse({ ...CHARGED, amountCents: Number.MAX_SAFE_INTEGER + 2 }).success, false, "unsafe integer");
  assert.equal(s.safeParse({ ...CHARGED, paidAt: "yesterday" }).success, false, "paidAt not a date");
  assert.equal(s.safeParse({ ...CHARGED, chargeId: "" }).success, false, "empty chargeId");
  assert.equal(s.safeParse({ ...UNKNOWN, chargeId: undefined }).success, false, "unknown needs the chargeId");
  assert.equal(s.safeParse({ status: "manual", reason: "card_expired" }).success, false, "reason outside the two");
  assert.equal(s.safeParse({ status: "manual" }).success, false, "manual needs a reason");
  assert.equal(s.safeParse({ status: "declined" }).success, false, "declined needs a message");
  assert.equal(s.safeParse({}).success, false);
  assert.equal(s.safeParse(null).success, false);
});

test("request schema: addOnId and integer quoteCents >= 0; strict; request id 8-128", () => {
  const s = api.addOnChargeOnceRequestSchema;
  assert.ok(s, "addOnChargeOnceRequestSchema missing");
  assert.deepEqual(s.safeParse({ addOnId: "ao_1", quoteCents: 9900 }).data, { addOnId: "ao_1", quoteCents: 9900 });
  assert.equal(s.safeParse({ addOnId: "ao_1", quoteCents: 0 }).success, true, "zero is an integer >= 0");
  assert.equal(s.safeParse({ addOnId: "ao_1", quoteCents: 99.5 }).success, false, "fractional cents");
  assert.equal(s.safeParse({ addOnId: "ao_1", quoteCents: -1 }).success, false);
  assert.equal(s.safeParse({ addOnId: "ao_1", quoteCents: "9900" }).success, false);
  assert.equal(s.safeParse({ addOnId: "", quoteCents: 9900 }).success, false);
  assert.equal(s.safeParse({ addOnId: "ao_1" }).success, false, "quoteCents is required");
  assert.equal(s.safeParse({ addOnId: "ao_1", quoteCents: 9900, amountCents: 1 }).success, false, "no amount from the caller");
  const id = api.addOnChargeOnceRequestIdSchema;
  assert.equal(id.safeParse("12345678").success, true);
  assert.equal(id.safeParse("1234567").success, false);
  assert.equal(id.safeParse("x".repeat(129)).success, false);
  assert.equal(id.safeParse("x".repeat(128)).success, true);
});

test("GET query schema: requestId 8-128, strict; error schema keeps the code and extras; code list", () => {
  assert.equal(api.addOnChargeOnceQuerySchema.safeParse({ requestId: "req-12345678" }).success, true);
  assert.equal(api.addOnChargeOnceQuerySchema.safeParse({ requestId: "short" }).success, false);
  assert.equal(api.addOnChargeOnceQuerySchema.safeParse({ requestId: "req-12345678", tenantId: "t" }).success, false);
  assert.deepEqual([...api.ADD_ON_CHARGE_ONCE_ERROR_CODES].sort(), ["add_on_not_found", "add_on_not_one_time", "price_changed"]);
  for (const error of api.ADD_ON_CHARGE_ONCE_ERROR_CODES) assert.equal(api.addOnChargeOnceErrorSchema.safeParse({ error }).success, true, error);
  const future = api.addOnChargeOnceErrorSchema.safeParse({ error: "some_later_code", detail: 1 });
  assert.equal(future.success, true, "a later code still parses");
  assert.equal(future.data.detail, 1, "extras are kept");
  assert.equal(api.addOnChargeOnceErrorSchema.safeParse({}).success, false);
  assert.equal(api.ADD_ON_CHARGE_ONCE_IDEMPOTENCY_HEADER, "X-Idempotency-Key");
  assert.deepEqual([...api.ADD_ON_CHARGE_ONCE_MANUAL_REASONS], ["no_stripe_customer", "no_payment_method"]);
});

// ── the client methods, against a fake fetch ──────────────────────────────────

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

test("chargeOneTimeAddOn: POSTs the body with the idempotency key and returns charged / manual / unknown", async () => {
  for (const [status, body] of [[200, CHARGED], [200, MANUAL_A], [202, UNKNOWN]]) {
    const seen = [];
    await withClient(async (url, init) => { seen.push({ url: String(url), init }); return json(status, body); }, async (client) => {
      const r = await client.billing.chargeOneTimeAddOn("tenant_1", REQ, KEY);
      assert.deepEqual(r, body);
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "https://test.invalid/api/v1/billing/add-on/charge-once");
    assert.equal(seen[0].init.method, "POST");
    assert.deepEqual(JSON.parse(seen[0].init.body), REQ);
    assert.equal(seen[0].init.headers["X-Idempotency-Key"], KEY);
    assert.equal(seen[0].init.headers["Idempotency-Key"], KEY, "the unprefixed name carries the same value");
    assert.equal(seen[0].init.headers["X-Tenant-Id"], "tenant_1");
  }
});

test("chargeOneTimeAddOn: a 402 declined is an answer, not a throw", async () => {
  await withClient(async () => json(402, DECLINED), async (client) => {
    assert.deepEqual(await client.billing.chargeOneTimeAddOn("tenant_1", REQ, KEY), DECLINED);
  });
});

test("chargeOneTimeAddOn: 409 and 404 throw with the body kept; a 402 that is not a declined body still throws", async () => {
  await withClient(async () => json(409, { error: "price_changed" }), async (client) => {
    await assert.rejects(client.billing.chargeOneTimeAddOn("tenant_1", REQ, KEY), (e) => e instanceof RelloError && e.statusCode === 409 && api.addOnChargeOnceErrorSchema.safeParse(e.body).data.error === "price_changed");
  });
  await withClient(async () => json(404, { error: "add_on_not_found" }), async (client) => {
    await assert.rejects(client.billing.chargeOneTimeAddOn("tenant_1", REQ, KEY), (e) => e instanceof RelloNotFoundError);
  });
  await withClient(async () => json(402, { status: "charged", chargeId: "x", amountCents: 1, paidAt: ISO }), async (client) => {
    await assert.rejects(client.billing.chargeOneTimeAddOn("tenant_1", REQ, KEY), (e) => e instanceof RelloError && e.statusCode === 402);
  });
});

test("chargeOneTimeAddOn: an unreadable 200 is never read as charged; a bad request never leaves the process", async () => {
  await withClient(async () => json(200, { status: "paid" }), async (client) => {
    await assert.rejects(client.billing.chargeOneTimeAddOn("tenant_1", REQ, KEY), (e) => e instanceof RelloError && e.statusCode === 200);
  });
  let calls = 0;
  await withClient(async () => { calls++; return json(200, CHARGED); }, async (client) => {
    await assert.rejects(client.billing.chargeOneTimeAddOn("tenant_1", { addOnId: "ao_1", quoteCents: 99.5 }, KEY), (e) => e instanceof RelloValidationError);
    await assert.rejects(client.billing.chargeOneTimeAddOn("tenant_1", REQ, "short"), (e) => e instanceof RelloValidationError);
  });
  assert.equal(calls, 0, "validated before any fetch");
});

test("getOneTimeAddOnCharge: GETs by requestId and returns the same union; 404 throws not-found", async () => {
  const seen = [];
  await withClient(async (url, init) => { seen.push({ url: String(url), init }); return json(200, CHARGED); }, async (client) => {
    assert.deepEqual(await client.billing.getOneTimeAddOnCharge("tenant_1", KEY), CHARGED);
  });
  assert.equal(seen[0].url, `https://test.invalid/api/v1/billing/add-on/charge-once?requestId=${KEY}`);
  assert.equal(seen[0].init.method, "GET");
  await withClient(async () => json(202, UNKNOWN), async (client) => {
    assert.deepEqual(await client.billing.getOneTimeAddOnCharge("tenant_1", KEY), UNKNOWN);
  });
  await withClient(async () => json(404, { error: "charge_not_found" }), async (client) => {
    await assert.rejects(client.billing.getOneTimeAddOnCharge("tenant_1", KEY), (e) => e instanceof RelloNotFoundError);
  });
  await withClient(async () => json(200, CHARGED), async (client) => {
    await assert.rejects(client.billing.getOneTimeAddOnCharge("tenant_1", "short"), (e) => e instanceof RelloValidationError);
  });
});
