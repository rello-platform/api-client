/**
 * Canonical Harvest Home Intake base URL normalizer.
 *
 * Strips leading/trailing whitespace, trailing /api or /api/, and trailing
 * slashes from HH_INTAKE_URL so every caller can construct full paths from
 * the domain root:
 *   `${getHarvestHomeBaseUrl()}/api/intake`
 *   `${getHarvestHomeBaseUrl()}/api/intake/re-enrich`
 *
 * Guards against env-var misconfiguration where HH_INTAKE_URL includes
 * /api (e.g. https://harvesthome.app/api), which would otherwise produce
 * double-prefix URLs like /api/api/intake → 404. Mirrors the
 * getRelloBaseUrl() / getMiloBaseUrl() shape exactly per universal floor
 * § RELLO_API_URL convention.
 *
 * v2.14.0 — Wave C4b /api-retirement: HH_INTAKE_URL canonical shape moves
 * to domain-root (https://harvesthome.app); consumer code constructs the
 * full path (/api/intake, /api/intake/re-enrich, /api/intake/re-enrich-batch)
 * via this normalizer. Legacy /api-suffixed values (https://harvesthome.app/api)
 * are tolerated by the strip-regex during the migration window. Replaces
 * hand-rolled strip-/api regex previously inlined at
 * ~/Rello/src/lib/integrations/hh-intake.ts.
 *
 * @see PA-041 (the audit that consolidated the prior RELLO/MILO normalizers);
 *      DISCOVERED/hh-intake-url-api-retirement-pattern-required-2026-05-11
 */
export function getHarvestHomeBaseUrl(fallback = ""): string {
  const raw = (process.env.HH_INTAKE_URL || fallback).trim();
  return raw.replace(/\/api\/?$/, "").replace(/\/+$/, "");
}
