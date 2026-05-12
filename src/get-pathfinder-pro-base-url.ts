/**
 * Canonical Pathfinder Pro base URL normalizer.
 *
 * Strips leading/trailing whitespace, trailing /api or /api/, and trailing
 * slashes from PATHFINDER_PRO_API_URL so every caller can construct full
 * paths from the domain root:
 *   `${getPathfinderProBaseUrl()}/api/intakes/from-spoke`
 *   `${getPathfinderProBaseUrl()}/api/provisioning/agent`
 *
 * Guards against env-var misconfiguration where PATHFINDER_PRO_API_URL
 * includes /api (e.g. https://pathfinder-pro.app/api), which would
 * otherwise produce double-prefix URLs like /api/api/intakes/... → 404.
 *
 * Mirrors getRelloBaseUrl() / getMiloBaseUrl() / getHarvestHomeBaseUrl()
 * shape exactly per universal floor § RELLO_API_URL convention. Symmetric
 * defensive .trim() applied to the (env || fallback) read before regex
 * stripping, matching the v2.7.0 cross-helper retrofit (operator paste-time
 * mistakes can hit either env value or fallback; trimming both closes the
 * class).
 *
 * v2.16.0 — introduced for the Home Scout `get-pre-approved` CTA → PFP
 * cross-app build (Q-NEW-5 lock 2026-05-12). HS outbound caller in
 * src/lib/pathfinder-pro-client.ts (MAIN-BUILD wave) uses this helper to
 * construct the receiver URL. Sibling to the new
 * @rello-platform/pfp-intake-from-spoke payload schema package and the
 * @rello-platform/permissions::INTAKE_FROM_SPOKE_WRITE slug (v0.30.0).
 *
 * @see PA-041 (the audit that consolidated the prior RELLO/MILO normalizers);
 *      HS ANSWERS.md §16 Q-NEW-5 (cross-app integration architecture lock);
 *      ~SLUG-AUTH-DRIFT-PREVENTION-README.md §4 (URL convention)
 */
export function getPathfinderProBaseUrl(fallback = ""): string {
  const raw = (process.env.PATHFINDER_PRO_API_URL || fallback).trim();
  return raw.replace(/\/api\/?$/, "").replace(/\/+$/, "");
}
