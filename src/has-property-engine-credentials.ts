/**
 * Returns true when the spoke is configured with a PE credential.
 *
 * Call sites that need to short-circuit when PE is unconfigured (rather
 * than letting the request 401) can use this guard. The apiKey is passed
 * in by the caller (NOT read at module scope) for the same spoke-specific
 * env-naming reason documented on getPropertyEngineHeaders.
 *
 *   if (!hasPropertyEngineCredentials(process.env.X_TO_PROPERTY_ENGINE_API_KEY)) {
 *     return { ...EMPTY_PE_DATA, errors: ["PE not configured"] };
 *   }
 *
 * v2.17.0 — Introduced alongside getPropertyEngineBaseUrl for D5 dispatch.
 *
 * @see DISCOVERED-PFP-PE-CLIENT-LOCAL-NOT-API-CLIENT-PACKAGE-2026-05-12;
 *      feedback-cross-app-api-key-env-naming-source-to-target
 */
export function hasPropertyEngineCredentials(apiKey: string | undefined): boolean {
  return typeof apiKey === "string" && apiKey.length > 0;
}
