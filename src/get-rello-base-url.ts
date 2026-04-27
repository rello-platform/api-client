/**
 * Canonical Rello API base URL normalizer.
 *
 * Strips trailing /api or /api/ from RELLO_API_URL so every caller can
 * construct full paths from the domain root:
 *   `${getRelloBaseUrl()}/api/v1/agent-profile`
 *   `${getRelloBaseUrl()}/api/signals/batch`
 *
 * Guards against env-var misconfiguration where RELLO_API_URL includes
 * /api (e.g. https://hellorello.app/api), which would otherwise produce
 * double-prefix URLs like /api/api/v1/... → 404.
 *
 * Consolidated into @rello-platform/api-client v2.6.0; previously
 * duplicated byte-identically across 9 spokes' src/lib/rello-url.ts.
 *
 * @see PTA-022 (original normalizer); PA-041 (consolidation)
 */
export function getRelloBaseUrl(fallback = ""): string {
  const raw = process.env.RELLO_API_URL || fallback;
  return raw.replace(/\/api\/?$/, "").replace(/\/+$/, "");
}
