/**
 * Canonical Property Engine base URL normalizer.
 *
 * Strips leading/trailing whitespace, trailing /api or /api/, and trailing
 * slashes from PROPERTY_ENGINE_API_URL so every caller can construct full
 * paths from the domain root:
 *   `${getPropertyEngineBaseUrl()}/api/rates/current`
 *   `${getPropertyEngineBaseUrl()}/api/properties/lookup`
 *
 * Guards against env-var misconfiguration where PROPERTY_ENGINE_API_URL
 * includes /api (e.g. https://property-engine.app/api), which would
 * otherwise produce double-prefix URLs like /api/api/rates/current → 404.
 *
 * Mirrors getRelloBaseUrl() / getMiloBaseUrl() / getHarvestHomeBaseUrl() /
 * getPathfinderProBaseUrl() shape exactly per universal floor § RELLO_API_URL
 * convention. Symmetric defensive .trim() applied to the (env || fallback)
 * read before regex stripping, matching the v2.7.0 cross-helper retrofit
 * (operator paste-time mistakes can hit either env value or fallback;
 * trimming both closes the class).
 *
 * v2.17.0 — Introduced for the D5 Platform PE Client Canonicalization
 * dispatch (5-spoke local-copy retirement; The-Oven carved to D10 follow-up).
 * Closes DISCOVERED-PFP-PE-CLIENT-LOCAL-NOT-API-CLIENT-PACKAGE-2026-05-12.
 * Spokes Scout/MarketIntel/Drumbeat/PFP migrate from local
 * src/lib/property-engine/auth.ts copies to this canonical helper same-PR
 * per Rule J pre-delete verification.
 *
 * Note: prior local copies read process.env.PROPERTY_ENGINE_URL (no _API_
 * segment). The canonical helper reads PROPERTY_ENGINE_API_URL to align with
 * the platform-wide <SERVICE>_API_URL convention. The four migrating spokes
 * rename Railway env from PROPERTY_ENGINE_URL → PROPERTY_ENGINE_API_URL
 * same-coord per the D5 dispatch's Railway env-mirror block.
 *
 * @see DISCOVERED-PFP-PE-CLIENT-LOCAL-NOT-API-CLIENT-PACKAGE-2026-05-12;
 *      ~RATE-DATA-ARCHITECTURE-README.md (Pattern A consumer surfaces);
 *      feedback-cross-app-target-urls-via-api-client-base-url-helpers
 */
export function getPropertyEngineBaseUrl(fallback = ""): string {
  const raw = (process.env.PROPERTY_ENGINE_API_URL || fallback).trim();
  return raw.replace(/\/api\/?$/, "").replace(/\/+$/, "");
}
