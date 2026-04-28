/**
 * Canonical Rello API base URL normalizer.
 *
 * Strips leading/trailing whitespace, trailing /api or /api/, and trailing
 * slashes from RELLO_API_URL so every caller can construct full paths from
 * the domain root:
 *   `${getRelloBaseUrl()}/api/v1/agent-profile`
 *   `${getRelloBaseUrl()}/api/signals/batch`
 *
 * Guards against env-var misconfiguration where RELLO_API_URL includes
 * /api (e.g. https://hellorello.app/api), which would otherwise produce
 * double-prefix URLs like /api/api/v1/... → 404.
 *
 * v2.7.0 — symmetric defensive .trim() applied to the (env || fallback) read
 * before regex stripping, absorbing the e63a77d cross-spoke lockstep retrofit
 * permanently into the canonical. The retrofit was triggered by MarketIntel's
 * prod Railway MILO_API_URL carrying 1 trailing whitespace character ("https://
 * milo-engine-production.up.railway.app "), producing `Failed to parse URL
 * from .../app /api/...` at runtime. Operator paste-time mistakes can hit
 * either env value or fallback; trimming both closes the class.
 *
 * v2.6.0 — consolidated into @rello-platform/api-client; previously
 * duplicated byte-identically across 9 spokes' src/lib/rello-url.ts.
 *
 * @see PTA-022 (original normalizer); PA-041 (consolidation);
 *      PA-041 Phase B Class B THS halt-and-surface (defensive trim)
 */
export function getRelloBaseUrl(fallback = ""): string {
  const raw = (process.env.RELLO_API_URL || fallback).trim();
  return raw.replace(/\/api\/?$/, "").replace(/\/+$/, "");
}
