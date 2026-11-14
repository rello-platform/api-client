import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { PERMISSIONS } from "@rello-platform/permissions";
import { createServiceBearerGuard } from "../dist/index.js";

// Read inside each runtime test, so a missing slug fails that test and never
// stops the type test from reporting its own diagnostic.
const slugOf = (key) => PERMISSIONS[key].slug;

// v2.32.0: api-client's own @rello-platform/permissions dependency is the one
// PermissionSlug its guards are typed against. It must carry every slug a
// consumer route passes; rate-check:price (permissions v0.60.0) and
// agents:contact:write (v0.59.0) were missing at v2.31.0 (pin v0.54.0).

test("type: createServiceBearerGuard accepts permission \"rate-check:price\" (and callerHasPermission \"agents:contact:write\")", () => {
  const fixture = fileURLToPath(new URL("./types/rate-check-price.fixture.ts", import.meta.url));
  const program = ts.createProgram([fixture], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2020.d.ts", "lib.dom.d.ts"],
    skipLibCheck: true,
    types: [],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => {
    const where = d.file && d.start !== undefined ? `${d.file.fileName}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1} ` : "";
    return `${where}TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
  });
  assert.deepEqual(diagnostics, []);
});

function req(headers = {}) {
  return new Request("https://home-scout.test/api/internal/rate-check/price", { method: "POST", headers });
}

test("runtime: a key without rate-check:price is refused 403 PERMISSION_DENIED", async () => {
  const RATE_CHECK_PRICE = slugOf("RATE_CHECK_PRICE");
  const PROVISIONING_WRITE = slugOf("PROVISIONING_WRITE");
  const guard = createServiceBearerGuard({
    getValidator: () => async () => ({ appSource: "RELLO", keyId: "ak_rcp_1", permissions: [PROVISIONING_WRITE] }),
  });
  const result = await guard(req({ authorization: "Bearer rello_x" }), { permission: RATE_CHECK_PRICE });
  assert.ok(result instanceof Response);
  assert.equal(result.status, 403);
  const body = await result.json();
  assert.equal(body.code, "PERMISSION_DENIED");
  assert.match(body.error, /rate-check:price/);
});

test("runtime: a key holding rate-check:price passes and returns the caller", async () => {
  const RATE_CHECK_PRICE = slugOf("RATE_CHECK_PRICE");
  const guard = createServiceBearerGuard({
    getValidator: () => async () => ({ appSource: "RELLO", keyId: "ak_rcp_2", permissions: [RATE_CHECK_PRICE] }),
  });
  const result = await guard(req({ authorization: "Bearer rello_ok" }), { permission: RATE_CHECK_PRICE });
  assert.ok(!(result instanceof Response));
  assert.equal(result.keyId, "ak_rcp_2");
});
