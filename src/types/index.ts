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
  ContextCacheResponse,
  RecordOfflineInteractionInput,
  OfflineInteractionResponse,
  EntityType,
} from "./lead.js";

export type {
  EmitSignalInput,
  EmitSignalBatchResult,
} from "./signal.js";

export type {
  CreateEventInput,
  Event,
} from "./event.js";

export type {
  EnrollFlowInput,
  EnrollJourneyInput,
  Enrollment,
  Journey,
  JourneyListParams,
} from "./flow.js";

export type {
  CheckoutInput,
  UsageInput,
  BillingStatus,
  EntitlementResult,
} from "./billing.js";

export type {
  EffectiveSettings,
} from "./settings.js";

export type {
  CanSendInput,
  CanSendResult,
} from "./communication.js";

export type {
  CreateActivityInput,
} from "./activity.js";

export type {
  AppInfo,
} from "./platform.js";

export type {
  UpdateAgentInput,
  Agent,
} from "./agent.js";

export type {
  Tag,
  TagsListParams,
  TagSearchParams,
} from "./tag.js";

export type {
  Segment,
  SegmentRules,
  CreateSegmentInput,
} from "./segment.js";

export type {
  MiloOptimizationInput,
  MiloOptimizationResponse,
  MiloContentInput,
  MiloContentResponse,
} from "./milo.js";

export type {
  LeadShare,
  LeadShareOwner,
  LeadShareLead,
  LeadSharesListParams,
} from "./lead-share.js";

export type {
  TeamAgent,
  TeamStats,
} from "./team.js";

export type {
  ReportIngestInput,
} from "./report.js";

export type {
  ProvisionedAgent,
  TenantEnablePayload,
  TenantPlanGrants,
  TenantCyrState,
  TenantDisablePayload,
  TenantProvisioningPayload,
  AgentProvisionPayload,
} from "./provisioning.js";

export type {
  ValidateSessionInput,
  ValidateSessionResponse,
  ValidateSessionError,
  ValidatedUser,
  ValidatedTenant,
} from "./auth.js";

export type {
  LogAiUsageInput,
  LogAiUsageResponse,
} from "./admin.js";

export type {
  AddressNormalizeFreeFormInput,
  AddressNormalizePreSplitInput,
  AddressNormalizeRequest,
  AddressNormalizeMatchedBy,
  AddressNormalizeResponse,
} from "./address-normalize.js";

export type {
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
} from "./property-autofill.js";

export { PROPERTY_AUTOFILL_FIELD_KEYS } from "./property-autofill.js";

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
} from "./provisioning.js";

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
} from "./roster.js";
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
} from "./roster.js";

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
} from "./sms-setup.js";
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
} from "./sms-setup.js";

// PFP Gateway G-10R + G-EXTRAS (PKG-2): plan switch and add-on quantity
export {
  PLAN_SWITCH_INTERVALS,
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
} from "./billing-switch.js";
export type {
  PlanSwitchInterval,
  PlanSwitchPreviewQuery,
  PlanSwitchPreviewLine,
  PlanSwitchPreviewSubscription,
  PlanSwitchPreviewResponse,
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
} from "./billing-switch.js";

// PFP Gateway P-1: tenant-bound v1 billing reads (plan grants)
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
} from "./v1-billing-reads.js";
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
} from "./v1-billing-reads.js";

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
} from "./embed-token.js";
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
} from "./embed-token.js";
