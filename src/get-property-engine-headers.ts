/**
 * Canonical Property Engine request headers.
 *
 * Returns the headers a spoke must send on outbound PE requests:
 *   Authorization: Bearer <apiKey>
 *   Content-Type: application/json
 *
 * The apiKey is passed by the caller (NOT read from env at module scope)
 * because each spoke's PE credential lives under a spoke-specific Railway
 * env var per `<SOURCE>_TO_<TARGET>_API_KEY` naming convention (e.g.,
 * PATHFINDER_PRO_TO_PROPERTY_ENGINE_API_KEY,
 * THE_HOME_SCOUT_TO_PROPERTY_ENGINE_API_KEY). The package-level helper
 * cannot close over a spoke-specific env name — each call site reads its
 * own env var and passes the value in.
 *
 * Wire format matches both PE inbound auth paths:
 *   Path A (canonical): Bearer rello_<platform_apikey>
 *   Path B (legacy):    Bearer <PROPERTY_ENGINE_API_KEY literal>
 * PE's middleware routes by the `rello_` prefix; both paths are accepted
 * during the Centralized ApiKey Migration window.
 *
 * v2.17.0 — Introduced alongside getPropertyEngineBaseUrl for D5 dispatch.
 *
 * @see DISCOVERED-PFP-PE-CLIENT-LOCAL-NOT-API-CLIENT-PACKAGE-2026-05-12;
 *      feedback-cross-app-api-key-env-naming-source-to-target
 */
export function getPropertyEngineHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}
