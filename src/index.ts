// --- Client factories ---

import { RelloClient, type RelloClientConfig } from "./client.js";
import { ServiceClient, type ServiceClientConfig } from "./service-client.js";

/**
 * Create a typed Rello API client. Reads config from env vars by default:
 *   RELLO_API_URL  — base URL (must NOT include "/api")
 *   RELLO_API_KEY  — API key (falls back to RELLO_APP_SECRET)
 *   APP_SLUG       — this app's slug identifier
 *
 * @example
 *   const rello = createRelloClient();
 *   const lead = await rello.leads.create(tenantId, { email: "..." });
 */
export function createRelloClient(config?: RelloClientConfig): RelloClient {
  return new RelloClient(config);
}

/**
 * Create a client for spoke-to-spoke service calls. Same retry, circuit
 * breaker, and error handling as the Rello client, but targets any service.
 *
 * @example
 *   const ns = createServiceClient({
 *     baseUrl: process.env.NEWSLETTER_STUDIO_URL!,
 *     apiKey: process.env.NEWSLETTER_STUDIO_SECRET!,
 *     appSlug: "the-drumbeat",
 *   });
 *   await ns.post("/api/campaigns/send", { ... });
 */
export function createServiceClient(config: ServiceClientConfig): ServiceClient {
  return new ServiceClient(config);
}

// --- Re-exports ---

export { RelloClient, type RelloClientConfig } from "./client.js";
export { ServiceClient, type ServiceClientConfig } from "./service-client.js";

// Errors
export {
  RelloError,
  RelloNotFoundError,
  RelloAuthError,
  RelloForbiddenError,
  RelloValidationError,
  RelloRateLimitError,
  RelloUnavailableError,
} from "./errors.js";

// Types
export type {
  Lead,
  CreateLeadInput,
  UpdateLeadInput,
  ListLeadsParams,
  ConversionScore,
  EmitSignalInput,
  CreateEventInput,
  Event,
  EnrollFlowInput,
  EnrollJourneyInput,
  Enrollment,
  CheckoutInput,
  UsageInput,
  BillingStatus,
  EntitlementResult,
  EffectiveSettings,
  CanSendInput,
  CanSendResult,
  CreateActivityInput,
} from "./types/index.js";
