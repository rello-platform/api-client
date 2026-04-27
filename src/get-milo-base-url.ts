/**
 * Canonical Milo Engine base URL normalizer.
 *
 * Strips trailing /api or /api/ from MILO_API_URL so every caller can
 * construct full paths from the domain root:
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
 * @see PA-041 (the audit that surfaced the gap; PFP rate-sheet upload
 *      was silent-404 broken end-to-end until 6c207d5 fixed the inline
 *      URL construction).
 */
export function getMiloBaseUrl(fallback = ""): string {
  const raw = process.env.MILO_API_URL || fallback;
  return raw.replace(/\/api\/?$/, "").replace(/\/+$/, "");
}
