interface TransportConfig {
    baseUrl: string;
    apiKey: string;
    appSlug: string;
    timeouts?: Partial<TimeoutConfig>;
    retryAttempts?: number;
    circuitBreakerThreshold?: number;
    circuitBreakerCooldownMs?: number;
}
interface TimeoutConfig {
    default: number;
    read: number;
    write: number;
    long: number;
}
type TimeoutPreset = keyof TimeoutConfig;
declare class Transport {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly appSlug;
    private readonly timeouts;
    private readonly retryAttempts;
    private readonly circuitBreaker;
    constructor(config: TransportConfig);
    /** Returns the app slug used for X-App-Slug header and signal source attribution. */
    getAppSlug(): string;
    /**
     * Make an authenticated request to Rello.
     */
    request<T>(method: string, path: string, options: {
        tenantId: string;
        body?: unknown;
        query?: Record<string, string | undefined>;
        timeout?: TimeoutPreset;
        headers?: Record<string, string>;
    }): Promise<T>;
    private doFetch;
    get<T>(path: string, tenantId: string, query?: Record<string, string | undefined>, timeout?: TimeoutPreset): Promise<T>;
    post<T>(path: string, tenantId: string, body: unknown, timeout?: TimeoutPreset): Promise<T>;
    patch<T>(path: string, tenantId: string, body: unknown, timeout?: TimeoutPreset): Promise<T>;
    delete<T>(path: string, tenantId: string, timeout?: TimeoutPreset): Promise<T>;
}

interface Lead {
    id: string;
    email: string | null;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    currentStage: string;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    referralSource: string | null;
    customFields: Record<string, unknown> | null;
    tenantId: string;
    createdAt: string;
    updatedAt: string;
}
interface CreateLeadInput {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    referralSource?: string;
    source?: string;
    tags?: string[];
    customFields?: Record<string, unknown>;
}
interface UpdateLeadInput {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    currentStage?: string;
    customFields?: Record<string, unknown>;
    coBorrowerFirstName?: string;
    coBorrowerLastName?: string;
    coBorrowerSource?: string;
    coBorrowerUpdatedAt?: string;
    [key: string]: unknown;
}
interface ListLeadsParams {
    limit?: number;
    offset?: number;
    page?: number;
    tags?: string[];
    email?: string;
    search?: string;
    stage?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
}
interface ConversionScore {
    score: number;
    factors: Record<string, unknown>;
    updatedAt: string;
}

declare class LeadsResource {
    private readonly transport;
    constructor(transport: Transport);
    create(tenantId: string, data: CreateLeadInput): Promise<Lead>;
    get(tenantId: string, id: string): Promise<Lead>;
    update(tenantId: string, id: string, data: UpdateLeadInput): Promise<Lead>;
    /**
     * Find a lead by exact email match.
     *
     * Implementation: uses the `search` query param (case-insensitive `contains`
     * on email, firstName, and lastName in Rello's getLeads) then verifies exact
     * email match client-side. Returns null if no lead with that exact email exists.
     *
     * Uses limit=25 to reduce the chance of the exact match being pushed out of
     * results by partial first/last name matches. A full email address as the search
     * term rarely produces more than a few hits, but defensive limit is warranted.
     */
    findByEmail(tenantId: string, email: string): Promise<Lead | null>;
    /**
     * Find an existing lead by email, or create a new one if not found.
     *
     * Deduplication is by exact email match (case-insensitive). If the input
     * has no email, a new lead is always created (cannot dedup without email).
     *
     * Handles the TOCTOU race condition: if another process creates the same
     * lead between our findByEmail and create calls, and Rello returns a
     * conflict (409) or validation error (400), we retry findByEmail once.
     * This prevents duplicate creation under concurrent writes.
     *
     * @returns The lead and whether it was newly created.
     *
     * @example
     *   const { lead, created } = await rello.leads.createOrFind(tenantId, {
     *     email: "buyer@example.com",
     *     firstName: "Jane",
     *     source: "the-home-scout",
     *   });
     *   if (!created) console.log("Existing lead:", lead.id);
     */
    createOrFind(tenantId: string, data: CreateLeadInput): Promise<{
        lead: Lead;
        created: boolean;
    }>;
    list(tenantId: string, params?: ListLeadsParams): Promise<Lead[]>;
    applyTags(tenantId: string, id: string, tags: string[]): Promise<void>;
    setCustomFields(tenantId: string, id: string, fields: Record<string, unknown>): Promise<void>;
    getConversionScore(tenantId: string, id: string): Promise<ConversionScore>;
}

/**
 * Input for emitting a single signal to Rello's signal router.
 *
 * Field names match Rello's POST /api/signals contract:
 *   - `signalType` (not "type") — Rello returns 400 if missing
 *   - `leadId` (required) — Rello returns 400 if missing
 *   - `payload` (not "data") — Rello returns 400 if missing or non-object
 *   - `source` — Rello returns 400 if missing; auto-filled from appSlug
 */
interface EmitSignalInput {
    /** Signal type identifier. Use dotted notation for namespacing (e.g., "homeready.assessment_completed"). */
    signalType: string;
    /** Rello lead ID this signal relates to. */
    leadId: string;
    /** Signal priority. The batch endpoint maps "NORMAL" to "MEDIUM" internally. */
    priority?: "CRITICAL" | "HIGH" | "MEDIUM" | "NORMAL" | "LOW";
    /** Arbitrary signal data. Sent as the `payload` field to Rello. */
    payload?: Record<string, unknown>;
    /** Custom fields to merge into the lead's customFields on Rello. Embedded inside `payload.customFields` before send. */
    customFields?: Record<string, unknown>;
    /** Source app identifier. Defaults to the client's appSlug if omitted. */
    source?: string;
    /** ISO 8601 timestamp. Used by the batch endpoint. Defaults to now if omitted. */
    timestamp?: string;
}
/** Result from a batch signal emission. */
interface EmitSignalBatchResult {
    /** Number of signals successfully processed by Rello. */
    processed: number;
    /** Number of signals that failed processing. */
    failed: number;
    /** Total signals submitted. */
    total: number;
    /**
     * Per-signal error details. Present only when emitBatch falls back to
     * sequential individual calls (no signalKey configured). Apps can use
     * this to build dead-letter queues for failed signals.
     *
     * Not present when the batch endpoint is used directly — the server
     * returns only aggregate counts.
     */
    errors?: Array<{
        signalType: string;
        leadId: string;
        error: string;
    }>;
}

/**
 * Signal emission resource.
 *
 * Single signals are sent to POST /api/v1/signals (v1 auth via database API key).
 * Batch signals are sent to POST /api/v1/signals/batch (requires signalKey —
 * a separate SIGNAL_ROUTER_SECRET credential). If no signalKey is configured,
 * emitBatch falls back to sequential single-signal calls.
 */
declare class SignalsResource {
    private readonly transport;
    private readonly signalKey;
    constructor(transport: Transport, signalKey: string | undefined);
    /**
     * Emit a single signal to Rello's signal router.
     *
     * Uses the standard v1 API key auth (same as leads, events, etc.).
     * The `source` field defaults to the client's appSlug if not provided.
     * If `customFields` is provided, it is embedded inside `payload.customFields`.
     *
     * @throws {Error} If signalType or leadId is missing (validates locally before sending).
     *
     * @example
     *   await rello.signals.emit(tenantId, {
     *     signalType: "homeready.assessment_completed",
     *     leadId: "lead_abc123",
     *     payload: { score: 72 },
     *     customFields: { hr_score: 72 },
     *   });
     */
    emit(tenantId: string, signal: EmitSignalInput): Promise<void>;
    /**
     * Emit multiple signals in a single HTTP call.
     *
     * Requires `signalKey` in the client config (or RELLO_SIGNAL_KEY / SIGNAL_ROUTER_SECRET
     * env var). The batch endpoint uses a different auth credential than the standard v1 API.
     *
     * If no signalKey is configured, falls back to sequential single-signal calls
     * using the standard v1 auth. This is slower (N HTTP calls) but works without
     * the separate credential.
     *
     * Maximum 200 signals per call (enforced by Rello's batch endpoint). For larger
     * batches, call emitBatch multiple times.
     *
     * @example
     *   const result = await rello.signals.emitBatch(tenantId, [
     *     { signalType: "email_opened", leadId: "lead_1", payload: { articleId: "a1" } },
     *     { signalType: "email_clicked", leadId: "lead_2", payload: { url: "..." } },
     *   ]);
     *   console.log(result); // { processed: 2, failed: 0, total: 2 }
     */
    emitBatch(tenantId: string, signals: EmitSignalInput[]): Promise<EmitSignalBatchResult>;
    /**
     * Batch endpoint: POST /api/v1/signals/batch
     * Auth: Bearer {signalKey} (SIGNAL_ROUTER_SECRET, NOT the standard API key)
     */
    private emitBatchDirect;
    /**
     * Fallback: send each signal individually via the single-signal endpoint.
     * Slower (N HTTP calls) but works with standard v1 API key auth.
     *
     * Collects per-signal errors so callers can build dead-letter queues.
     */
    private emitBatchFallback;
}

interface CreateEventInput {
    type: string;
    leadId?: string;
    data?: Record<string, unknown>;
    source?: string;
    actorType?: "SYSTEM" | "USER" | "AGENT" | "MLO" | "LEAD" | "ENGINE" | "API";
    actorId?: string;
    title?: string;
    description?: string;
    visibility?: "ALL" | "AGENT_ONLY" | "SYSTEM_ONLY";
}
interface Event {
    id: string;
    leadId: string | null;
    tenantId: string;
    eventType: string;
    sourceApp: string;
    actorType: string;
    title: string | null;
    description: string | null;
    data: Record<string, unknown> | null;
    createdAt: string;
}

declare class EventsResource {
    private readonly transport;
    constructor(transport: Transport);
    create(tenantId: string, event: CreateEventInput): Promise<Event>;
}

interface CreateActivityInput {
    leadId: string;
    type: string;
    title?: string;
    description?: string;
    data?: Record<string, unknown>;
    source?: string;
}

declare class ActivitiesResource {
    private readonly transport;
    constructor(transport: Transport);
    create(tenantId: string, activity: CreateActivityInput): Promise<Event>;
}

interface EnrollFlowInput {
    leadId: string;
    flowSlug: string;
    source?: string;
    context?: Record<string, unknown>;
}
interface EnrollJourneyInput {
    leadId: string;
    journeySlug: string;
    source?: string;
    context?: Record<string, unknown>;
    goalContext?: {
        intent: string;
        constraints: string[];
        urgency: string;
    };
}
interface Enrollment {
    id: string;
    journeyId: string;
    leadId: string;
    tenantId: string;
    status: string;
    enrollmentSource: string;
    enrolledAt: string;
}

declare class FlowsResource {
    private readonly transport;
    constructor(transport: Transport);
    enroll(tenantId: string, leadId: string, flowSlug: string, context?: Record<string, unknown>): Promise<Enrollment>;
}
declare class JourneysResource {
    private readonly transport;
    constructor(transport: Transport);
    enroll(tenantId: string, leadId: string, journeySlug: string, context?: Record<string, unknown>, goalContext?: EnrollJourneyInput["goalContext"]): Promise<Enrollment>;
}

declare class SettingsResource {
    private readonly transport;
    constructor(transport: Transport);
    getEffective(tenantId: string, keys: string[]): Promise<Record<string, unknown>>;
}

interface CheckoutInput {
    productType: string;
    quantity?: number;
    unitPriceCents?: number;
    returnUrl: string;
    app?: string;
    plan?: string;
}
interface UsageInput {
    metric: string;
    quantity: number;
    metadata?: Record<string, unknown>;
}
interface BillingStatus {
    subscription: unknown;
    addOns: unknown[];
    usage: unknown;
    limits: unknown;
}
interface EntitlementResult {
    allowed: boolean;
    tier?: string;
    limits?: Record<string, unknown>;
    expiresAt?: string;
    trialEndsAt?: string;
    isTrialing?: boolean;
    isExpired?: boolean;
}

declare class BillingResource {
    private readonly transport;
    constructor(transport: Transport);
    createCheckout(tenantId: string, input: CheckoutInput): Promise<{
        url: string;
    }>;
    getStatus(tenantId: string): Promise<BillingStatus>;
    reportUsage(tenantId: string, metric: string, quantity: number, metadata?: Record<string, unknown>): Promise<void>;
    checkEntitlement(tenantId: string, appSlug: string): Promise<EntitlementResult>;
}

interface CanSendInput {
    leadId: string;
    channel: "email" | "sms" | "phone";
    urgency?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    senderId?: string;
    senderType?: string;
}
interface CanSendResult {
    allowed: boolean;
    checks: Array<{
        name: string;
        passed: boolean;
        reason?: string;
    }>;
    blockedBy?: string;
}

declare class CommunicationsResource {
    private readonly transport;
    constructor(transport: Transport);
    canSend(tenantId: string, input: CanSendInput): Promise<CanSendResult>;
}

interface Prompt {
    id: string;
    slug: string;
    name: string;
    systemPrompt: string;
    userPromptTemplate: string;
    model: string;
    temperature: number;
    maxTokens: number;
}
declare class PromptsResource {
    private readonly transport;
    constructor(transport: Transport);
    get(slug: string, tenantId?: string): Promise<Prompt | null>;
}

declare class WebhooksResource {
    private readonly transport;
    constructor(transport: Transport);
    documentUpload(tenantId: string, payload: Record<string, unknown>): Promise<void>;
}

interface RelloClientConfig {
    /** Rello API base URL. Default: RELLO_API_URL env var. Must NOT include "/api". */
    baseUrl?: string;
    /** API key for authentication. Default: RELLO_API_KEY or RELLO_APP_SECRET env var. */
    apiKey?: string;
    /** This app's slug identifier. Default: APP_SLUG env var. */
    appSlug?: string;
    /**
     * Signal router secret for batch signal emission.
     * Default: RELLO_SIGNAL_KEY or SIGNAL_ROUTER_SECRET env var.
     *
     * The batch signal endpoint (/api/signals/batch) uses a different credential
     * than the standard v1 API. If not set, emitBatch() falls back to sequential
     * single-signal calls using the standard API key.
     */
    signalKey?: string;
    /** Per-method timeout overrides in milliseconds. */
    timeouts?: Partial<TransportConfig["timeouts"]>;
    /** Number of retry attempts for transient errors. Default: 3. */
    retryAttempts?: number;
    /** Consecutive failures before circuit breaker opens. Default: 5. */
    circuitBreakerThreshold?: number;
    /** Circuit breaker cooldown in ms. Default: 30000. */
    circuitBreakerCooldownMs?: number;
}
declare class RelloClient {
    readonly leads: LeadsResource;
    readonly signals: SignalsResource;
    readonly events: EventsResource;
    readonly activities: ActivitiesResource;
    readonly flows: FlowsResource;
    readonly journeys: JourneysResource;
    readonly settings: SettingsResource;
    readonly billing: BillingResource;
    readonly communications: CommunicationsResource;
    readonly prompts: PromptsResource;
    readonly webhooks: WebhooksResource;
    constructor(config?: RelloClientConfig);
}

interface ServiceClientConfig {
    /** Base URL of the target service (e.g., process.env.NEWSLETTER_STUDIO_URL). */
    baseUrl: string;
    /** API key for the target service. */
    apiKey: string;
    /** This app's slug, sent as X-App-Slug. */
    appSlug: string;
    /** Request timeout in milliseconds. Default: 10000. */
    timeoutMs?: number;
    /** Number of retry attempts. Default: 3. */
    retryAttempts?: number;
}
/**
 * Generic service-to-service client for spoke-to-spoke calls.
 * Provides the same retry, circuit breaker, and error handling
 * as the Rello client, but targets any platform service.
 */
declare class ServiceClient {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly appSlug;
    private readonly timeoutMs;
    private readonly retryAttempts;
    private readonly circuitBreaker;
    constructor(config: ServiceClientConfig);
    post<T>(path: string, body: unknown, tenantId?: string): Promise<T>;
    get<T>(path: string, tenantId?: string): Promise<T>;
    patch<T>(path: string, body: unknown, tenantId?: string): Promise<T>;
    private request;
}

/**
 * Configuration for the platform key validator.
 */
interface PlatformKeyValidatorConfig {
    /** Rello API base URL (e.g., "https://hellorello.app"). Must NOT include "/api". */
    relloApiUrl: string;
    /** API key to authenticate with Rello's service-keys endpoint. */
    relloApiKey: string;
    /**
     * This app's identifier, passed as the targetApp query parameter.
     * Accepts any format — will be normalized to UPPER_SNAKE_CASE for the API call.
     * Example: "newsletter-studio" or "NEWSLETTER_STUDIO"
     */
    ownAppSlug: string;
    /** Cache TTL in milliseconds. Default: 300000 (5 minutes). */
    cacheTtlMs?: number;
}
/**
 * Result of a successful caller validation.
 */
interface PlatformCaller {
    /** The appSource from the ApiKey record (e.g., "THE_DRUMBEAT"). */
    appSource: string;
    /** The ApiKey record ID. */
    keyId: string;
    /** Permissions array from the ApiKey record. */
    permissions: string[];
}
/**
 * Create a validator for inbound platform service-to-service calls.
 *
 * The returned function authenticates incoming requests by:
 *   1. Extracting the Bearer token from the Authorization header
 *   2. SHA-256 hashing the token
 *   3. Comparing the hash against keys fetched from Rello (cached 5 min)
 *
 * Identity comes from the token itself — not from X-App-Slug. The caller
 * is identified by which key they hold, preventing self-reported identity spoofing.
 *
 * Graceful degradation: if Rello is unreachable, the last-known key cache
 * is used. Keys don't rotate often, so stale data is safer than failing auth.
 *
 * @example
 *   import { createPlatformKeyValidator } from "@rello-platform/api-client";
 *
 *   const validateCaller = createPlatformKeyValidator({
 *     relloApiUrl: process.env.RELLO_API_URL!,
 *     relloApiKey: process.env.RELLO_API_KEY!,
 *     ownAppSlug: process.env.APP_SLUG!,
 *   });
 *
 *   // In a route handler or middleware:
 *   const caller = await validateCaller(request);
 *   if (!caller) {
 *     return new Response("Unauthorized", { status: 401 });
 *   }
 *   console.log(`Authenticated caller: ${caller.appSource}`);
 */
declare function createPlatformKeyValidator(config: PlatformKeyValidatorConfig): (request: Request) => Promise<PlatformCaller | null>;

/**
 * Base error class for all Rello API errors.
 */
declare class RelloError extends Error {
    readonly statusCode: number;
    readonly path: string;
    readonly requestId: string | null;
    readonly body: unknown;
    constructor(message: string, statusCode: number, path: string, requestId: string | null, body: unknown);
}
/**
 * Thrown when the requested resource does not exist (404).
 */
declare class RelloNotFoundError extends RelloError {
    constructor(path: string, requestId: string | null, body: unknown);
}
/**
 * Thrown when the API key is invalid, expired, or missing (401).
 */
declare class RelloAuthError extends RelloError {
    constructor(path: string, requestId: string | null, body: unknown);
}
/**
 * Thrown when the API key lacks required permissions (403).
 */
declare class RelloForbiddenError extends RelloError {
    constructor(path: string, requestId: string | null, body: unknown);
}
/**
 * Thrown when the request is malformed or invalid (400).
 */
declare class RelloValidationError extends RelloError {
    readonly details: unknown;
    constructor(path: string, requestId: string | null, body: unknown, details?: unknown);
}
/**
 * Thrown when the rate limit has been exceeded (429).
 */
declare class RelloRateLimitError extends RelloError {
    readonly retryAfter: number;
    constructor(path: string, requestId: string | null, body: unknown, retryAfter: number);
}
/**
 * Thrown when Rello is unavailable — either the circuit breaker is open
 * or all retry attempts have been exhausted.
 */
declare class RelloUnavailableError extends RelloError {
    readonly retryAfter: number;
    constructor(message: string, retryAfter: number);
}

interface EffectiveSettings {
    settings: Record<string, unknown>;
}

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
declare function createRelloClient(config?: RelloClientConfig): RelloClient;
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
declare function createServiceClient(config: ServiceClientConfig): ServiceClient;

export { type BillingStatus, type CanSendInput, type CanSendResult, type CheckoutInput, type ConversionScore, type CreateActivityInput, type CreateEventInput, type CreateLeadInput, type EffectiveSettings, type EmitSignalBatchResult, type EmitSignalInput, type EnrollFlowInput, type EnrollJourneyInput, type Enrollment, type EntitlementResult, type Event, type Lead, type ListLeadsParams, type PlatformCaller, type PlatformKeyValidatorConfig, RelloAuthError, RelloClient, type RelloClientConfig, RelloError, RelloForbiddenError, RelloNotFoundError, RelloRateLimitError, RelloUnavailableError, RelloValidationError, ServiceClient, type ServiceClientConfig, type UpdateLeadInput, type UsageInput, createPlatformKeyValidator, createRelloClient, createServiceClient };
