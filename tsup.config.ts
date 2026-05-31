import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  // Dual ESM + CJS output (v2.24.0). The ESM build (dist/index.js) is unchanged
  // for existing ESM consumers (Rello, spokes); the CJS build (dist/index.cjs)
  // makes the package require()-able from CommonJS consumers (Milo-Engine compiles
  // to CJS and require()d the ESM-only export → ERR_PACKAGE_PATH_NOT_EXPORTED at
  // runtime, forcing a local getRelloBaseUrl redeclare). Additive — no public API change.
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2020",
  outDir: "dist",
});
