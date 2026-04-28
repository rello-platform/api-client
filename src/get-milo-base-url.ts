/**
 * Canonical Milo Engine base URL normalizer.
 *
 * Strips leading/trailing whitespace, trailing /api or /api/, and trailing
 * slashes from MILO_API_URL so every caller can construct full paths from
 * the domain root:
 *   `${getMiloBaseUrl()}/api/decide`
 *   `${getMiloBaseUrl()}/api/personalize-content`
 *   `${getMiloBaseUrl()}/api/document-analyze`
 *
 * Guards against env-var misconfiguration where MILO_API_URL includes
 * /api (e.g. https://milo-engine-production.up.railway.app/api), which
 * would otherwise produce double-prefix URLs like /api/api/decide → 404.
 *
 * Mirrors the getRelloBaseUrl() shape exactly. Reads MILO_API_URL only
 * (not MILO_ENGINE_URL — dual-name retirement is a separate workstream
 * per PA-041 §5).
 *
 * v2.7.0 — symmetric defensive .trim() applied to the (env || fallback) read
 * before regex stripping, absorbing commit e63a77d's cross-spoke lockstep
 * retrofit (NS, OHH, MI, HR, HS) permanently into the canonical. The retrofit
 * was triggered by MarketIntel's prod Railway MILO_API_URL carrying 1 trailing
 * whitespace character ("https://milo-engine-production.up.railway.app "),
 * producing `Failed to parse URL from .../app /api/analyze` at runtime when
 * the prior normalizer's regex didn't match because of the trailing space
 * after `/api`. Operator paste-time mistakes can hit either env value or
 * fallback; trimming both closes the class. Trim runs BEFORE regex so values
 * like "https://x.app/api  " (whitespace after /api) get stripped correctly.
 *
 * @see PA-041 (the audit that surfaced the gap; PFP rate-sheet upload
 *      was silent-404 broken end-to-end until 6c207d5 fixed the inline
 *      URL construction);
 *      commit e63a77d (the lockstep retrofit being absorbed);
 *      PA-041 Phase B Class B THS halt-and-surface (canonical translation)
 */
export function getMiloBaseUrl(fallback = ""): string {
  const raw = (process.env.MILO_API_URL || fallback).trim();
  return raw.replace(/\/api\/?$/, "").replace(/\/+$/, "");
}
