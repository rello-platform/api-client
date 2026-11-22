// --- Client factories ---

import { RelloClient, type RelloClientConfig } from "./client.js";
import { ServiceClient, type ServiceClientConfig } from "./service-client.js";

// --- URL normalizers (consolidated 2026-04-27 per PA-041) ---

export { getRelloBaseUrl } from "./get-rello-base-url.js";
export { getMiloBaseUrl } from "./get-milo-base-url.js";
export { getHarvestHomeBaseUrl } from "./get-harvest-home-base-url.js";
export { getPathfinderProBaseUrl } from "./get-pathfinder-pro-base-url.js";
export { getOvenBaseUrl } from "./get-oven-base-url.js";
export { getPropertyEngineBaseUrl } from "./get-property-engine-base-url.js";
export { getPropertyEngineHeaders } from "./get-property-engine-headers.js";
export { hasPropertyEngineCredentials } from "./has-property-engine-credentials.js";

/**
 * Create a typed Rello API client. Reads config from env vars by default:
 *   RELLO_API_URL  — base URL (must NOT include "/api")
 *   RELLO_API_KEY  — API key (required if not passed in config)
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
  callerHasPermission,
  createServiceBearerGuard,
  type PlatformKeyValidatorConfig,
  type PlatformCaller,
  type ServiceBearerGuardConfig,
  type PlatformKeyValidator,
  type ValidatorNullReason,
  type ValidatorNullReport,
  callerTenantScope,
  isInAnchorWindow,
  USAGE_MAX_PENDING_KEYS,
  type CachedKey,
  type CallerTenantScope,
  type PlatformKeyUsageConfig,
  type UsageFlushOutcome,
  type UsageFlushResult,
  type ValidateCallOptions,
} from "./platform-key-validator.js";

// Deploy-time spoke→Rello permission self-check (outbound counterpart to the validator)
export {
  runRelloPermissionSelfCheck,
  createRelloPermissionSelfCheck,
  type RelloPermissionSelfCheckConfig,
  type SelfCheckResult,
} from "./rello-permission-selfcheck.js";

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
  PlanSwitchApiError,
} from "./errors.js";

// Types
export type {
  Lead,
  CreateLeadInput,
  EntityType,
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
  TenantPlanGrants,
  TenantCyrState,
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
  AddressNormalizeFreeFormInput,
  AddressNormalizePreSplitInput,
  AddressNormalizeRequest,
  AddressNormalizeMatchedBy,
  AddressNormalizeResponse,
  PropertyAutofillFreeFormInput,
  PropertyAutofillPreSplitInput,
  PropertyAutofillRequest,
  PropertyAutofillFieldKey,
  PropertyAutofillPropertyStatus,
  PropertyAutofillPropertyType,
  PropertyAutofillListing,
  PropertyAutofillFieldShape,
  PropertyAutofillAttomSummary,
  PropertyAutofillResponseSuccess,
  PropertyAutofillResponseError,
  PropertyAutofillResponse,
} from "./types/index.js";

export { PROPERTY_AUTOFILL_FIELD_KEYS } from "./types/index.js";

// Provisioning schemas + runtime validators
export {
  provisionedAgentSchema,
  tenantEnablePayloadSchema,
  tenantPlanGrantsSchema,
  tenantCyrStateSchema,
  tenantDisablePayloadSchema,
  tenantProvisioningPayloadSchema,
  agentProvisionPayloadSchema,
  parseTenantPayload,
  parseAgentPayload,
} from "./types/index.js";

// PFP Gateway X2 roster routes (loginless agent, team member)
export {
  loginlessAgentCreateRequestSchema,
  loginlessAgentRemoveRequestSchema,
  teamMemberCreateRequestSchema,
  teamMemberSignInLinkRequestSchema,
  teamMemberRemoveRequestSchema,
  teamLoginRosterQuerySchema,
  ROSTER_ERROR_CODES,
  loginlessAgentCreateResponseSchema,
  loginlessAgentRemoveResponseSchema,
  teamMemberCreateResponseSchema,
  teamMemberSignInLinkResponseSchema,
  teamMemberRemoveResponseSchema,
  teamLoginRosterMemberSchema,
  teamLoginRosterResponseSchema,
  rosterErrorSchema,
  isRosterErrorCode,
  signatureQuantityNeededSchema,
  alreadyMemberSchema,
  loginQuantityNeededSchema,
} from "./types/index.js";
export type {
  LoginlessAgentCreateRequest,
  LoginlessAgentCreateResponse,
  LoginlessAgentRemoveRequest,
  LoginlessAgentRemoveResponse,
  TeamMemberCreateRequest,
  TeamMemberCreateResponse,
  TeamMemberSignInLinkRequest,
  TeamMemberSignInLinkResponse,
  TeamMemberRemoveRequest,
  TeamMemberRemoveResponse,
  TeamLoginRosterQuery,
  TeamLoginRosterMember,
  TeamLoginRosterResponse,
  RosterErrorCode,
  RosterError,
  SignatureQuantityNeeded,
  AlreadyMember,
  LoginQuantityNeeded,
  RosterErrorParsed,
} from "./types/index.js";


// PFP Gateway G-10R + G-EXTRAS (PKG-2): plan switch and add-on quantity
export {
  PLAN_SWITCH_INTERVALS,
  PLAN_SWITCH_KEEP_ADDONS,
  planSwitchPreviewQuerySchema,
  planSwitchRequestSchema,
  PLAN_SWITCH_ERROR_CODES,
  PREVIEW_STALE_REASONS,
  previewStaleErrorSchema,
  addOnQuantityRequestSchema,
  ADDON_QUANTITY_ERROR_CODES,
  ADDON_QUANTITY_IDEMPOTENCY_HEADER,
  ADDON_QUANTITY_IDEMPOTENCY_KEY_LENGTH,
  addOnQuantityResponseSchema,
  ADDON_QUANTITY_IDEMPOTENCY_ERROR_CODES,
  extraMlosExceedQuantityErrorSchema,
  membersExceedQuantityErrorSchema,
  addOnQuantityOtherErrorSchema,
  addOnQuantityErrorSchema,
  isExtraMlosExceedQuantityError,
  isMembersExceedQuantityError,
  membersExceedTargetErrorSchema,
  planSwitchPreviewLineSchema,
  planSwitchPreviewSubscriptionSchema,
  planSwitchPreviewResponseSchema,
  planSwitchStepSchema,
  planSwitchAppliedResponseSchema,
  planSwitchOpenResponseSchema,
  planSwitchResponseSchema,
  planSwitchOperationResponseSchema,
  switchInProgressErrorSchema,
  planSwitchOtherErrorSchema,
  PLAN_SWITCH_DEDICATED_ERROR_CODES,
  planSwitchErrorSchema,
  isMembersExceedTargetError,
} from "./types/index.js";
export type {
  PlanSwitchInterval,
  PlanSwitchKeepAddOn,
  PlanSwitchPreviewQuery,
  PlanSwitchPreviewLine,
  PlanSwitchPreviewSubscription,
  PlanSwitchPreviewResponse,
  PlanSwitchApps,
  PlanSwitchRequestParsed,
  PlanSwitchRequest,
  PlanSwitchOperationStatus,
  PlanSwitchStepState,
  PlanSwitchStep,
  PlanSwitchAppliedResponse,
  PlanSwitchOpenResponse,
  PlanSwitchResponse,
  PlanSwitchOperationResponse,
  PlanSwitchErrorCode,
  PreviewStaleReason,
  PreviewStaleError,
  PlanSwitchError,
  AddOnQuantityRequest,
  AddOnQuantityResponse,
  AddOnQuantityErrorCode,
  AddOnQuantityError,
  AddOnQuantityIdempotencyErrorCode,
  ExtraMlosExceedQuantityError,
  MembersExceedQuantityError,
  AddOnQuantityOtherError,
  MembersExceedTargetError,
  SwitchInProgressError,
  PlanSwitchOtherError,
} from "./types/index.js";

// PFP Gateway P-1: tenant-bound v1 billing reads (plan grants, add-ons) and the add-on start
export {
  V1_TENANT_MATCH_ERRORS,
  appNotEnabledForTenantError,
  v1TenantMatchErrorSchema,
  planGrantsReadResponseSchema,
  PLAN_GRANTS_READ_ERROR_CODES,
  planGrantsReadErrorSchema,
  addOnUnitPriceSchema,
  addOnOneTimePriceSchema,
  TENANT_ADD_ON_STATUSES,
  v1AddOnTenantSubscriptionSchema,
  v1AddOnReadSchema,
  v1AddOnsReadResponseSchema,
  ADD_ONS_READ_ERROR_CODES,
  addOnsReadErrorSchema,
  ADD_ON_START_IDEMPOTENCY_HEADER,
  addOnStartRequestSchema,
  addOnStartResponseSchema,
  addOnStartErrorSchema,
  ADD_ON_START_ERROR_CODES,
} from "./types/index.js";
export type {
  V1TenantMatchError,
  PlanGrantsReadResponse,
  PlanGrantsReadErrorCode,
  PlanGrantsReadError,
  AddOnUnitPrice,
  AddOnOneTimePrice,
  V1AddOnTenantSubscription,
  V1AddOnRead,
  V1AddOnsReadResponse,
  AddOnsReadErrorCode,
  AddOnsReadError,
  AddOnStartRequest,
  AddOnStartResponse,
  AddOnStartError,
  AddOnStartErrorCode,
} from "./types/index.js";

// PFP Gateway "Match my design": the one-time add-on charge (KA prompt 1419)
export {
  ADD_ON_CHARGE_ONCE_IDEMPOTENCY_HEADER,
  ADD_ON_CHARGE_ONCE_IDEMPOTENCY_HEADER_ALIAS,
  addOnChargeOnceRequestIdSchema,
  addOnChargeOnceRequestSchema,
  addOnChargeOnceQuerySchema,
  addOnChargeOnceChargedSchema,
  addOnChargeOnceDeclinedSchema,
  addOnChargeOnceUnknownSchema,
  ADD_ON_CHARGE_ONCE_MANUAL_REASONS,
  addOnChargeOnceManualSchema,
  addOnChargeOnceAnswerSchema,
  ADD_ON_CHARGE_ONCE_ERROR_CODES,
  addOnChargeOnceErrorSchema,
} from "./types/index.js";
export type {
  AddOnChargeOnceRequest,
  AddOnChargeOnceQuery,
  AddOnChargeOnceManualReason,
  AddOnChargeOnceAnswer,
  AddOnChargeOnceCharged,
  AddOnChargeOnceDeclined,
  AddOnChargeOnceUnknown,
  AddOnChargeOnceManual,
  AddOnChargeOnceErrorCode,
  AddOnChargeOnceError,
} from "./types/index.js";

// PFP Gateway G-10R-2t-A: the once-per-tenant Full PFP plan trial (KA prompt 1451)
export {
  planTrialStateSchema,
  PLAN_CLASSES,
  isPlanClass,
  planTrialStartRequestSchema,
  planTrialStartResponseSchema,
  PLAN_TRIAL_START_ERROR_CODES,
  planTrialStartErrorSchema,
} from "./types/index.js";
export type {
  PlanTrialState,
  PlanClass,
  PlanTrialStartRequest,
  PlanTrialStartResponse,
  PlanTrialStartErrorCode,
  PlanTrialStartError,
} from "./types/index.js";

// PFP Gateway P-2: the embed token (mint, verify) and F2 tenant app access
export {
  EMBED_SURFACES,
  EMBED_TOKEN_SCOPES,
  EMBED_SURFACE_SCOPE,
  EMBED_TOKEN_AUDIENCE,
  EMBED_TOKEN_PREFIX,
  embedTokenMintRequestSchema,
  embedTokenMintResponseSchema,
  embedTokenVerifyRequestSchema,
  EMBED_TOKEN_INVALID_REASONS,
  embedTokenVerifyValidSchema,
  embedTokenVerifyInvalidSchema,
  embedTokenVerifyResponseSchema,
  tenantAppAccessResponseSchema,
  EMBED_TOKEN_ERRORS,
  EMBED_TOKEN_ERROR_STATUS,
  EMBED_TOKEN_REFRESH_MESSAGE,
  EMBED_TOKEN_MESSAGE,
  EMBED_SESSION_EXPIRED_MESSAGE,
} from "./types/index.js";
export type {
  EmbedSurface,
  EmbedTokenScope,
  EmbedTokenMintRequest,
  EmbedTokenMintResponse,
  EmbedTokenVerifyRequest,
  EmbedTokenInvalidReason,
  EmbedTokenVerifyValid,
  EmbedTokenVerifyInvalid,
  EmbedTokenVerifyResponse,
  TenantAppAccessResponse,
  EmbedTokenErrorCode,
} from "./types/index.js";

// PFP Gateway G-SETUP + G-A2P (setup charge, texting registration)
export {
  quoteVersion,
  setupChargeRequest,
  setupChargeStatus,
  setupChargeEnvelope,
  chargeConflict,
  feeSlugQuery,
  oneTimeFeeQuote,
  feeChangedConflict,
  feeNotFound,
  internalError,
  businessType,
  businessIndustry,
  smsRegistrationRequest,
  smsOtpRequest,
  smsRegistrationStatus,
  smsRegistrationEnvelope,
  registrationConflict,
  setupChargeChangedEvent,
  smsRegistrationChangedEvent,
} from "./types/index.js";
export type {
  SetupChargeRequest,
  SetupChargeStatus,
  SetupChargeEnvelope,
  ChargeConflict,
  FeeSlugQuery,
  OneTimeFeeQuote,
  FeeChangedConflict,
  FeeNotFound,
  InternalError,
  BusinessType,
  BusinessIndustry,
  SmsRegistrationRequest,
  SmsOtpRequest,
  SmsRegistrationStatus,
  SmsRegistrationEnvelope,
  RegistrationConflict,
  SetupChargeChangedEvent,
  SmsRegistrationChangedEvent,
} from "./types/index.js";


// Implicit-apiKey telemetry — lets a process be ASKED how many construction
// sites still rely on the RELLO_API_KEY fallback, rather than tailing a log a
// Trigger.dev worker writes to nobody. See implicit-apikey-telemetry.ts.
export {
  getImplicitApiKeyUses,
  getImplicitApiKeyCount,
  resetImplicitApiKeyUses,
  type ImplicitApiKeyUse,
} from "./implicit-apikey-telemetry.js";
