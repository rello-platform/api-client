import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as api from "../dist/index.js";

// PKG-2 fix round (Platform KA prompt 1202; AUDIT 106 / prompt 1201 HOLD
// GD-1971..1973 on #17 @ ddc94cde2). The add-on quantity PATCH is typed as R1
// serves it (#2381 @ 8afad20dc5), exactly.

const R1_SUCCESS = { tenantAddOnId: "ta_1", quantity: 2, quantityRev: "3", billedQuantity: 1, superseded: false };

test("GD-1971: R1's success data (no status, no subscriptionCanceled) parses; X1's fuller data parses too", () => {
  const s = api.addOnQuantityResponseSchema;
  assert.ok(s, "addOnQuantityResponseSchema missing");
  const r1 = s.safeParse(R1_SUCCESS);
  assert.equal(r1.success, true, JSON.stringify(r1.error?.issues));
  assert.equal(s.safeParse({ ...R1_SUCCESS, status: "ACTIVE", subscriptionCanceled: true }).success, true);
  assert.equal(s.safeParse({ ...R1_SUCCESS, quantityRev: 3 }).success, false, "quantityRev is a decimal string on the wire");
  assert.equal(s.safeParse({ tenantAddOnId: "ta_1", quantity: 2, quantityRev: "3" }).success, false, "billedQuantity and superseded are always sent");
});

test("GD-1972: the idempotency header is X-Idempotency-Key (R1's idempotency-header.ts), 8 to 128 characters", () => {
  assert.equal(api.ADDON_QUANTITY_IDEMPOTENCY_HEADER, "X-Idempotency-Key");
  assert.deepEqual(api.ADDON_QUANTITY_IDEMPOTENCY_KEY_LENGTH, { min: 8, max: 128 });
});

const ANSWERS = {
  "400 invalid body (no code)": { success: false, error: "Invalid request — quantity (whole number ≥ 0) and quantityRev are required" },
  "404 add-on not found (no code)": { success: false, error: "Add-on not found" },
  "403 another app's add-on (no code)": { success: false, error: "Forbidden — this add-on belongs to another app" },
  "503 billing not configured": { success: false, error: "Billing service not configured" },
  "500": { success: false, error: "Failed to change the add-on quantity" },
  "401 requireV1Auth (no success key)": { error: "Unauthorized" },
  "403 tenant-app guard": { error: "Forbidden — app 'x' is not enabled for tenant" },
  "400 IDEMPOTENCY_KEY_REQUIRED": { success: false, error: "X-Idempotency-Key header is required", code: "IDEMPOTENCY_KEY_REQUIRED" },
  "400 IDEMPOTENCY_KEY_INVALID": { success: false, error: "X-Idempotency-Key must be 8–128 characters", code: "IDEMPOTENCY_KEY_INVALID" },
  "422 IDEMPOTENCY_KEY_CONFLICT": { success: false, error: "X-Idempotency-Key is already bound to a request from a different tenant — send a new key for this request", code: "IDEMPOTENCY_KEY_CONFLICT" },
  "409 stale_quantity_rev + convergence": { success: false, error: "A newer quantity was already sent. (queued)", code: "stale_quantity_rev", convergence: "queued" },
  "409 extra_mlos_exceed_quantity": { success: false, error: "Remove an extra MLO first", code: "extra_mlos_exceed_quantity", activeLoginless: 3, quantity: 2 },
  "409 members_exceed_quantity": { success: false, error: "Remove a team member first", code: "members_exceed_quantity", activeMembers: 6, quantity: 5 },
  "an unknown later code": { success: false, error: "A code a later Rello adds", code: "some_later_code" },
};

test("GD-1973: every real answer of the route parses as an AddOnQuantityError, extra fields kept", () => {
  const s = api.addOnQuantityErrorSchema;
  assert.ok(s, "addOnQuantityErrorSchema missing");
  for (const [name, body] of Object.entries(ANSWERS)) {
    const r = s.safeParse(body);
    assert.equal(r.success, true, `${name}: ${JSON.stringify(r.error?.issues)}`);
    assert.deepEqual(r.data, body, `${name}: nothing dropped`);
  }
  assert.equal(s.safeParse({ success: true, data: R1_SUCCESS }).success, false, "a success is not an error");
  assert.equal(s.safeParse({ success: false }).success, false, "error (the message) is always present");
});

test("GD-1973: the idempotency codes are their own list; the domain list is unchanged", () => {
  assert.deepEqual([...api.ADDON_QUANTITY_IDEMPOTENCY_ERROR_CODES].sort(), ["IDEMPOTENCY_KEY_CONFLICT", "IDEMPOTENCY_KEY_INVALID", "IDEMPOTENCY_KEY_REQUIRED"]);
  assert.equal(api.ADDON_QUANTITY_ERROR_CODES.length, 12);
});

test("GD-1973: the exact domain branches narrow only with their fields", () => {
  assert.equal(api.isExtraMlosExceedQuantityError(ANSWERS["409 extra_mlos_exceed_quantity"]), true);
  assert.equal(api.isExtraMlosExceedQuantityError({ success: false, error: "x", code: "extra_mlos_exceed_quantity" }), false, "no fields: not the exact branch");
  assert.equal(api.isMembersExceedQuantityError(ANSWERS["409 members_exceed_quantity"]), true);
  assert.equal(api.isMembersExceedQuantityError(ANSWERS["409 extra_mlos_exceed_quantity"]), false);
  assert.equal(api.isExtraMlosExceedQuantityError(ANSWERS["404 add-on not found (no code)"]), false);
});

test("type: each real answer and R1's success compile against the built types", () => {
  const fixture = fileURLToPath(new URL("./types/pkg2-addon-quantity-wire.fixture.ts", import.meta.url));
  const program = ts.createProgram([fixture], {
    strict: true, noEmit: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ["lib.es2020.d.ts", "lib.dom.d.ts"], skipLibCheck: true, types: [],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => {
    const where = d.file && d.start !== undefined ? `${d.file.fileName}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1} ` : "";
    return `${where}TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
  });
  assert.deepEqual(diagnostics, []);
});
