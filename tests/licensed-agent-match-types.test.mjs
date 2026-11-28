import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import ts from "typescript";

// v2.50.0 (HI-22): Property Engine's POST /api/licensed-agents/match contract, types only.

function diagnosticsOf(fixtureName) {
  const fixture = fileURLToPath(new URL(`./types/${fixtureName}`, import.meta.url));
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
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const where = d.file && d.start !== undefined ? `${d.file.fileName.split("/").pop()}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1} ` : "";
    return `${where}TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
  });
}

test("type: the request, every result variant and an exhaustive switch compile against the built dist", () => {
  assert.deepEqual(diagnosticsOf("licensed-agent-match.fixture.ts"), []);
});

test("type: a wrong confidence, a missing licenseStatus and an unknown input key are each refused", () => {
  const d = diagnosticsOf("licensed-agent-match-wrong.fixture.ts");
  const lines = new Set(d.map((x) => Number(/:(\d+) /.exec(x)?.[1])));
  assert.deepEqual([...lines].sort((a, b) => a - b), [5, 7, 9], d.join("\n"));
});

test("dist carries no runtime code for the contract (types only)", () => {
  const js = readFileSync(fileURLToPath(new URL("../dist/index.js", import.meta.url)), "utf8");
  assert.doesNotMatch(js, /LicensedAgentMatch/);
  const dts = readFileSync(fileURLToPath(new URL("../dist/index.d.ts", import.meta.url)), "utf8");
  assert.match(dts, /LicensedAgentMatchResponse/);
});
