import { test } from "node:test";
import assert from "node:assert/strict";
import * as api from "../dist/index.js";
import { createRelloClient, RelloError, RelloValidationError, RelloUnavailableError } from "../dist/index.js";

// Platform KA prompt 1545 (UPGRADE-TO-RELLO, design §D6, KA ruling 1541): the plan-switch contract the
// eight apps call, as client methods, plus additive fields.
//   billing.previewPlanSwitch(tenantId, q)        GET  /api/v1/billing/plan-switch/preview
//   billing.switchPlan(tenantId, body)            POST /api/v1/billing/plan-switch
//   billing.getPlanSwitch(tenantId, operationId)  GET  /api/v1/billing/plan-switch/[operationId]
// A 4xx/5xx answer throws PlanSwitchApiError { status, body: parsed with planSwitchErrorSchema or null, raw }.
// Additive fields: preview apps? / amountDueNow?, relloUrl? on the APPLIED and operation answers, planClass?
// on the two plan-grants shapes, and PLAN_SWITCH_ERROR_CODES + no_plan_subscription.
// Every fixture is hand-written from the contract (no Rello route serves the new fields yet).
// Each stub only RECORDS the request; every assertion runs after the call returns.

const TENANT = "tenant_1545";
const STEPS = [{ index: 0, kind: "PLAN", state: "DONE" }];
const PREVIEW_OLD = {
  previewId: "pv_1",
  expiresAt: "2026-11-20T23:15:00.000Z",
  prorationDate: "2026-11-20T23:00:00.000Z",
  requiresConfirmation: false,
  subscriptions: [{ kind: "plan", lines: [{ description: "Rello Pro", amount: 4900, currency: "usd", period: { start: "2026-11-20T23:00:00.000Z", end: "2026-12-20T23:00:00.000Z" }, proration: true }], total: 4900 }],
  planChange: { from: "pfp-starter", to: "rello-pro", fromInterval: "month", toInterval: "month" },
  chargeChange: { carriedCheckYourRateSeat: false, refiRadarDrops: false },
};
const APPS = { kept: ["pathfinder-pro"], added: ["rello"], dropped: [] };
const PREVIEW_NEW = { ...PREVIEW_OLD, apps: APPS, amountDueNow: 4900 };
const RELLO_URL = "https://hellorello.app/welcome/rello?op=op_1";
const APPLIED_OLD = { operationId: "op_1", status: "APPLIED", steps: STEPS, planSlug: "rello-pro", interval: "month", invoiceIds: ["in_1"] };
const OPERATION_OLD = { operationId: "op_1", status: "APPLIED", steps: STEPS, previewId: "pv_1", invoiceIds: ["in_1"], resolutionNeeded: false, unknownSince: null };
const REQUEST = { targetPlanSlug: "rello-pro", idempotencyKey: "upgrade-0001" };
const GRANTS_PUSH = { rev: 3, grants: ["pfp-full"], planSlug: "rello-pro" };
const GRANTS_READ = { rev: 3, grants: ["pfp-full"], planSlug: "rello-pro", cyr: null };

function withClient(fetchImpl, fn, config = {}) {
  const prev = { f: globalThis.fetch, u: process.env.RELLO_API_URL, k: process.env.RELLO_API_KEY, s: process.env.APP_SLUG };
  globalThis.fetch = fetchImpl;
  process.env.RELLO_API_URL = "https://test.invalid";
  process.env.RELLO_API_KEY = "test-key";
  process.env.APP_SLUG = "open-house-hub";
  const restore = () => {
    globalThis.fetch = prev.f;
    for (const [k, v] of [["RELLO_API_URL", prev.u], ["RELLO_API_KEY", prev.k], ["APP_SLUG", prev.s]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };
  return Promise.resolve().then(() => fn(createRelloClient(config))).finally(restore);
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A stub that answers `responses` in order and records each request. */
function recorder(...responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, headers: { ...(init?.headers ?? {}) }, body: init?.body });
    const next = responses[Math.min(calls.length, responses.length) - 1];
    return typeof next === "function" ? next() : next;
  };
  return { calls, fetchImpl };
}

async function thrown(p) {
  try {
    await p;
  } catch (e) {
    return e;
  }
  assert.fail("expected a throw");
}

// ─── exports ────────────────────────────────────────────────────────────────

test("exports: the three methods, PlanSwitchApiError, PLAN_CLASSES/isPlanClass; no_plan_subscription appended after the 19 earlier codes", () => {
  assert.equal(typeof api.PlanSwitchApiError, "function", "PlanSwitchApiError missing");
  assert.ok(api.PlanSwitchApiError.prototype instanceof RelloError, "PlanSwitchApiError extends RelloError");
  const c = createRelloClient({ baseUrl: "https://test.invalid", apiKey: "k", appSlug: "open-house-hub" });
  for (const m of ["previewPlanSwitch", "switchPlan", "getPlanSwitch"]) assert.equal(typeof c.billing[m], "function", `billing.${m}`);
  const before = ["invalid_body", "idempotency_key_reused", "switch_not_allowed", "contact_sales", "members_exceed_target", "addon_price_not_configured", "billing_mode_classic", "already_on_plan", "confirmation_required", "preview_stale", "preview_consumed", "stale_switch", "switch_in_progress", "payment_failed", "provider_unreadable", "not_armed", "use_plan_switch", "operation_not_found", "addon_not_offered"];
  assert.deepEqual([...api.PLAN_SWITCH_ERROR_CODES], [...before, "no_plan_subscription"]);
  assert.deepEqual([...api.PLAN_CLASSES], ["rello", "app"]);
  assert.equal(api.isPlanClass("rello"), true);
  assert.equal(api.isPlanClass("app"), true);
  for (const x of ["bundle", "", "Rello", null, undefined, 1]) assert.equal(api.isPlanClass(x), false, JSON.stringify(x));
});

// ─── round trips ────────────────────────────────────────────────────────────

test("previewPlanSwitch: GET …/plan-switch/preview with the query, the key and X-Tenant-Id; apps and amountDueNow come back", async () => {
  const { calls, fetchImpl } = recorder(json(200, PREVIEW_NEW));
  const out = await withClient(fetchImpl, (c) => c.billing.previewPlanSwitch(TENANT, { targetPlanSlug: "rello-pro", interval: "month", keepAddOns: "refi-radar" }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  const u = new URL(calls[0].url);
  assert.equal(u.origin + u.pathname, "https://test.invalid/api/v1/billing/plan-switch/preview");
  assert.deepEqual(Object.fromEntries(u.searchParams), { targetPlanSlug: "rello-pro", interval: "month", keepAddOns: "refi-radar" });
  assert.equal(calls[0].headers.Authorization, "Bearer test-key");
  assert.equal(calls[0].headers["X-Tenant-Id"], TENANT);
  assert.equal(calls[0].body, undefined, "a GET sends no body");
  assert.deepEqual(out, PREVIEW_NEW);
});

test("previewPlanSwitch: an old server's answer (no apps, no amountDueNow) parses and the keys stay absent", async () => {
  const { calls, fetchImpl } = recorder(json(200, PREVIEW_OLD));
  const out = await withClient(fetchImpl, (c) => c.billing.previewPlanSwitch(TENANT, { targetPlanSlug: "rello-pro" }));
  assert.deepEqual(Object.fromEntries(new URL(calls[0].url).searchParams), { targetPlanSlug: "rello-pro" }, "absent params are not sent");
  assert.deepEqual(out, PREVIEW_OLD);
  assert.equal("apps" in out, false);
  assert.equal("amountDueNow" in out, false);
});

test("switchPlan: POST …/plan-switch with the body as sent; APPLIED carries relloUrl (string, null, or absent from an old server); 202 OPEN", async () => {
  const body = { ...REQUEST, previewId: "pv_1", confirmedChargeChange: true };
  const a = recorder(json(200, { ...APPLIED_OLD, relloUrl: RELLO_URL }));
  const applied = await withClient(a.fetchImpl, (c) => c.billing.switchPlan(TENANT, body));
  assert.equal(a.calls.length, 1);
  assert.equal(a.calls[0].method, "POST");
  assert.equal(a.calls[0].url, "https://test.invalid/api/v1/billing/plan-switch");
  assert.equal(a.calls[0].headers["X-Tenant-Id"], TENANT);
  assert.deepEqual(JSON.parse(a.calls[0].body), body);
  assert.deepEqual(applied, { ...APPLIED_OLD, relloUrl: RELLO_URL });

  const n = recorder(json(200, { ...APPLIED_OLD, relloUrl: null }));
  assert.equal((await withClient(n.fetchImpl, (c) => c.billing.switchPlan(TENANT, REQUEST))).relloUrl, null, "null = a non-Rello target");

  const o = recorder(json(200, APPLIED_OLD));
  const old = await withClient(o.fetchImpl, (c) => c.billing.switchPlan(TENANT, REQUEST));
  assert.deepEqual(old, APPLIED_OLD);
  assert.equal("relloUrl" in old, false, "an old server's answer: absent, never defaulted to null");

  const p = recorder(json(202, { operationId: "op_2", status: "OPEN" }));
  assert.deepEqual(await withClient(p.fetchImpl, (c) => c.billing.switchPlan(TENANT, REQUEST)), { operationId: "op_2", status: "OPEN" });
});

test("switchPlan: a body the contract refuses (a tenant field; a short key) is a RelloValidationError and nothing is sent", async () => {
  for (const bad of [{ ...REQUEST, tenantId: "other" }, { ...REQUEST, idempotencyKey: "short" }, { targetPlanSlug: "rello-pro" }]) {
    const { calls, fetchImpl } = recorder(json(200, APPLIED_OLD));
    const e = await thrown(withClient(fetchImpl, (c) => c.billing.switchPlan(TENANT, bad)));
    assert.ok(e instanceof RelloValidationError, JSON.stringify(bad));
    assert.equal(calls.length, 0, `no request for ${JSON.stringify(bad)}`);
  }
});

test("getPlanSwitch: GET …/plan-switch/<id>, the id path-encoded; relloUrl kept, or absent from an old server", async () => {
  const a = recorder(json(200, { ...OPERATION_OLD, relloUrl: RELLO_URL }));
  const op = await withClient(a.fetchImpl, (c) => c.billing.getPlanSwitch(TENANT, "op_1"));
  assert.equal(a.calls[0].method, "GET");
  assert.equal(a.calls[0].url, "https://test.invalid/api/v1/billing/plan-switch/op_1");
  assert.equal(a.calls[0].headers["X-Tenant-Id"], TENANT);
  assert.deepEqual(op, { ...OPERATION_OLD, relloUrl: RELLO_URL });

  const b = recorder(json(200, OPERATION_OLD));
  const old = await withClient(b.fetchImpl, (c) => c.billing.getPlanSwitch(TENANT, "op/../x?y"));
  assert.equal(b.calls[0].url, "https://test.invalid/api/v1/billing/plan-switch/op%2F..%2Fx%3Fy");
  assert.equal("relloUrl" in old, false);

  const { calls, fetchImpl } = recorder(json(200, OPERATION_OLD));
  assert.ok((await thrown(withClient(fetchImpl, (c) => c.billing.getPlanSwitch(TENANT, "")))) instanceof RelloValidationError);
  assert.equal(calls.length, 0, "an empty id sends nothing");
});

// ─── refusals ───────────────────────────────────────────────────────────────

test("409 use_plan_switch: PlanSwitchApiError, status 409, the parsed body, instanceof RelloError", async () => {
  const refusal = { error: "use_plan_switch", message: "Change the plan through the plan switch." };
  const { fetchImpl } = recorder(json(409, refusal));
  const e = await thrown(withClient(fetchImpl, (c) => c.billing.switchPlan(TENANT, REQUEST)));
  assert.ok(e instanceof api.PlanSwitchApiError, e?.name);
  assert.ok(e instanceof RelloError);
  assert.equal(e.status, 409);
  assert.equal(e.statusCode, 409);
  assert.deepEqual(e.body, refusal);
  assert.deepEqual(e.raw, refusal);
});

test("400 no_plan_subscription: PlanSwitchApiError 400 with the named code, from the preview", async () => {
  const refusal = { error: "no_plan_subscription", message: "No plan subscription yet." };
  const { fetchImpl } = recorder(json(400, refusal));
  const e = await thrown(withClient(fetchImpl, (c) => c.billing.previewPlanSwitch(TENANT, { targetPlanSlug: "rello-pro" })));
  assert.ok(e instanceof api.PlanSwitchApiError, e?.name);
  assert.equal(e.status, 400);
  assert.equal(e.body.error, "no_plan_subscription");
  assert.ok(api.PLAN_SWITCH_ERROR_CODES.includes(e.body.error));
});

test("non-JSON 502: PlanSwitchApiError keeps status 502 and the raw text; body is null, never a made-up code", async () => {
  const html = "<html><body>502 Bad Gateway</body></html>";
  const { calls, fetchImpl } = recorder(() => new Response(html, { status: 502, headers: { "content-type": "text/html" } }));
  const e = await thrown(withClient(fetchImpl, (c) => c.billing.getPlanSwitch(TENANT, "op_1"), { retryAttempts: 1 }));
  assert.equal(calls.length, 1);
  assert.ok(e instanceof api.PlanSwitchApiError, e?.name);
  assert.equal(e.status, 502);
  assert.equal(e.body, null);
  assert.equal(e.raw, html);
});

test("a refusal naming a dedicated code but malformed parses to null (raw kept); a well-formed one parses exactly", async () => {
  const bad = { error: "members_exceed_target", activeMembers: -1 };
  const a = recorder(json(409, bad));
  const e1 = await thrown(withClient(a.fetchImpl, (c) => c.billing.switchPlan(TENANT, REQUEST)));
  assert.ok(e1 instanceof api.PlanSwitchApiError);
  assert.equal(e1.body, null, "a malformed dedicated refusal is never accepted through the open branch");
  assert.deepEqual(e1.raw, bad);

  const good = { error: "switch_in_progress", operationId: "op_9" };
  const b = recorder(json(409, good));
  const e2 = await thrown(withClient(b.fetchImpl, (c) => c.billing.switchPlan(TENANT, REQUEST)));
  assert.deepEqual(e2.body, good);

  const later = { error: "a_code_rello_adds_later", message: "x", extra: 1 };
  const d = recorder(json(409, later));
  const e3 = await thrown(withClient(d.fetchImpl, (c) => c.billing.switchPlan(TENANT, REQUEST)));
  assert.deepEqual(e3.body, later, "an unknown code is still an answer (the open branch keeps extra fields)");
});

test("a request that never got an HTTP answer stays RelloUnavailableError (not a PlanSwitchApiError)", async () => {
  const e = await thrown(withClient(async () => { throw new TypeError("fetch failed"); }, (c) => c.billing.switchPlan(TENANT, REQUEST), { retryAttempts: 1 }));
  assert.ok(e instanceof RelloUnavailableError, e?.name);
  assert.equal(e instanceof api.PlanSwitchApiError, false);
});

test("a 2xx body this client cannot read is thrown as a RelloError, never returned as an answer", async () => {
  const { fetchImpl } = recorder(json(200, { operationId: "op_1", status: "DONE" }));
  const e = await thrown(withClient(fetchImpl, (c) => c.billing.switchPlan(TENANT, REQUEST)));
  assert.ok(e instanceof RelloError);
  assert.equal(e instanceof api.PlanSwitchApiError, false, "not a refusal");
  assert.deepEqual(e.body, { operationId: "op_1", status: "DONE" });
});

// ─── schemas, both directions ───────────────────────────────────────────────

test("preview schema: apps and amountDueNow optional; malformed ones refused", () => {
  const s = api.planSwitchPreviewResponseSchema;
  assert.deepEqual(s.parse(PREVIEW_NEW), PREVIEW_NEW);
  assert.deepEqual(s.parse({ ...PREVIEW_OLD, amountDueNow: -1200 }).amountDueNow, -1200, "a credit is a negative minor amount");
  for (const bad of [{ kept: "rello", added: [], dropped: [] }, { kept: [], added: [] }, { kept: [1], added: [], dropped: [] }, null]) {
    assert.equal(s.safeParse({ ...PREVIEW_OLD, apps: bad }).success, false, `apps ${JSON.stringify(bad)}`);
  }
  for (const bad of [12.5, "4900", null]) assert.equal(s.safeParse({ ...PREVIEW_OLD, amountDueNow: bad }).success, false, `amountDueNow ${JSON.stringify(bad)}`);
});

test("relloUrl: string | null | absent on APPLIED and the operation; a number is refused", () => {
  for (const [s, base] of [[api.planSwitchAppliedResponseSchema, APPLIED_OLD], [api.planSwitchOperationResponseSchema, OPERATION_OLD]]) {
    assert.equal(s.parse({ ...base, relloUrl: RELLO_URL }).relloUrl, RELLO_URL);
    assert.equal(s.parse({ ...base, relloUrl: null }).relloUrl, null);
    assert.equal("relloUrl" in s.parse(base), false);
    assert.equal(s.safeParse({ ...base, relloUrl: 5 }).success, false);
  }
});

test("planClass on both plan-grants shapes: an open string like `cause`; absent stays absent; empty or non-string refused", () => {
  for (const [s, base] of [[api.tenantPlanGrantsSchema, GRANTS_PUSH], [api.planGrantsReadResponseSchema, GRANTS_READ]]) {
    assert.equal(s.parse({ ...base, planClass: "rello" }).planClass, "rello");
    assert.equal(s.parse({ ...base, planClass: "app" }).planClass, "app");
    assert.equal(s.parse({ ...base, planClass: "bundle" }).planClass, "bundle", "a class Rello adds later never refuses the grants");
    assert.equal("planClass" in s.parse(base), false, "an older Rello: absent, never defaulted");
    for (const bad of ["", 1, null]) assert.equal(s.safeParse({ ...base, planClass: bad }).success, false, `planClass ${JSON.stringify(bad)}`);
  }
});

test("the request schema is unchanged: an old caller's body parses", () => {
  assert.deepEqual(api.planSwitchRequestSchema.parse(REQUEST), REQUEST);
  assert.equal(api.planSwitchErrorSchema.safeParse({ error: "no_plan_subscription" }).success, true);
});
