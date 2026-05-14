/**
 * Canonical The-Oven base URL normalizer.
 *
 * Strips leading/trailing whitespace, trailing /api or /api/, and trailing
 * slashes from THE_OVEN_API_URL so every caller can construct full paths
 * from the domain root:
 *   `${getOvenBaseUrl()}/api/homeowner-profile/${leadId}?tenantId=${tenantId}`
 *
 * Guards against env-var misconfiguration where THE_OVEN_API_URL includes
 * /api (e.g. https://the-oven.hellorello.app/api), which would otherwise
 * produce double-prefix URLs like /api/api/homeowner-profile/... → 404.
 *
 * Mirrors getRelloBaseUrl() / getMiloBaseUrl() / getHarvestHomeBaseUrl() /
 * getPathfinderProBaseUrl() shape exactly per universal floor § RELLO_API_URL
 * convention. Symmetric defensive .trim() applied to the (env || fallback)
 * read before regex stripping, matching the v2.7.0 cross-helper retrofit
 * (operator paste-time mistakes can hit either env value or fallback;
 * trimming both closes the class).
 *
 * Env-var name: THE_OVEN_API_URL — canonical SCREAMING_SNAKE form derived
 * from the `the-oven` app slug per `@rello-platform/slugs` APP_SLUGS. New
 * spokes adopting this helper should mint THE_OVEN_API_URL on their
 * Railway env (legacy callsites using the shorter OVEN_API_URL — e.g.
 * Harvest-Home's `src/lib/oven-client.ts` — predate the canonical naming
 * convention and live outside this helper's scope; see
 * feedback-homestretch-outbound-to-rello-uses-legacy-rello-api-key-naming
 * for the wider legacy-vs-canonical pattern).
 *
 * v2.19.0 — introduced for the Rello MLO RATE CHANGE MONITOR build
 * (ANSWERS.md Q9 lock 2026-05-14, Phase D0). Phase D consumes this helper
 * in `~/Rello/src/lib/rate-data/anchors.ts` to construct the Bearer-S2S
 * read URL for Oven's HomeownerProfile.originalRate (lowest-priority
 * anchor source in the SPEC §2.7 priority chain: `hh_lien1_rate` >
 * `scout_rate_alert_target_rate` > `HomeownerProfile.originalRate` >
 * none). Phase G consumes this helper in
 * `~/Rello/src/trigger/jobs/refi-target-sweep.ts` to walk the same anchor
 * source from the refi-target sweep cron. Both callers authenticate with
 * the `oven:homeowner-profile-read` permission slug
 * (`PERMISSIONS.OVEN_HOMEOWNER_PROFILE_READ` from
 * `@rello-platform/permissions`), against a (RELLO, THE_OVEN) ApiKey row
 * minted via Platform Admin → Apps → Settings. Sibling to the new
 * Rello-side reader; receiver endpoint `GET /api/homeowner-profile/[leadId]`
 * exists at The-Oven origin/main per RECON R9 §B (returns `null` JSON 200
 * for missing rows per the em-dash Rule L convention).
 *
 * @see BUILD-|-WORKSTREAM/MLO RATE CHANGE MONITOR/ Phase D0;
 *      BUILD-|-WORKSTREAM/MLO RATE CHANGE MONITOR/ANSWERS.md Q9 (lock);
 *      BUILD-|-WORKSTREAM/MLO RATE CHANGE MONITOR/RECON-R9-OVEN-HOMEOWNER-PROFILE-FINDINGS-2026-05-14.md § "CRITICAL FINDING" (helper-absence baseline) + §B (Oven endpoint shape);
 *      ~SLUG-AUTH-DRIFT-PREVENTION-README.md §4 (URL convention)
 */
export function getOvenBaseUrl(fallback = ""): string {
  const raw = (process.env.THE_OVEN_API_URL || fallback).trim();
  return raw.replace(/\/api\/?$/, "").replace(/\/+$/, "");
}
