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

// Platform key validation (Phase B: receiving app authenticates callers via Rello)
export {
  createPlatformKeyValidator,
  type PlatformKeyValidatorConfig,
  type PlatformCaller,
} from "./platform-key-validator.js";

// Resource classes (for advanced consumers who need direct access)
export { AuthResource } from "./resources/auth.js";
export { AdminResource } from "./resources/admin.js";

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
  LeadsPage,
  NurtureDecision,
  NurtureDecisionParams,
  FindByTagsInput,
  FindByTagsResult,
  BatchTagsResult,
  EmitSignalInput,
  EmitSignalBatchResult,
  CreateEventInput,
  Event,
  EnrollFlowInput,
  EnrollJourneyInput,
  Enrollment,
  Journey,
  JourneyListParams,
  CheckoutInput,
  UsageInput,
  BillingStatus,
  EntitlementResult,
  EffectiveSettings,
  CanSendInput,
  CanSendResult,
  CreateActivityInput,
  AppInfo,
  UpdateAgentInput,
  Agent,
  Tag,
  TagsListParams,
  TagSearchParams,
  Segment,
  SegmentRules,
  CreateSegmentInput,
  MiloOptimizationInput,
  MiloOptimizationResponse,
  MiloContentInput,
  MiloContentResponse,
  LeadShare,
  LeadShareOwner,
  LeadShareLead,
  LeadSharesListParams,
  TeamAgent,
  TeamStats,
  ContextCacheResponse,
  RecordOfflineInteractionInput,
  OfflineInteractionResponse,
  ReportIngestInput,
  ProvisionedAgent,
  TenantEnablePayload,
  TenantDisablePayload,
  TenantProvisioningPayload,
  AgentProvisionPayload,
  ValidateSessionInput,
  ValidateSessionResponse,
  ValidateSessionError,
  ValidatedUser,
  ValidatedTenant,
  LogAiUsageInput,
  LogAiUsageResponse,
} from "./types/index.js";

// Provisioning schemas + runtime validators
export {
  provisionedAgentSchema,
  tenantEnablePayloadSchema,
  tenantDisablePayloadSchema,
  tenantProvisioningPayloadSchema,
  agentProvisionPayloadSchema,
  parseTenantPayload,
  parseAgentPayload,
} from "./types/index.js";
