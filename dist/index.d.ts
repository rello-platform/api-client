import { z } from 'zod';

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
    /** Returns the API key used for Authorization headers. Used by PlatformResource to create ServiceClients. */
    getApiKey(): string;
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
/**
 * Input for creating a lead in Rello.
 *
 * Field names match Rello's createLeadSchema (src/lib/leads/validation.ts).
 * Rello uses Zod validation — unknown fields are stripped, so only fields
 * listed here will be accepted by the server.
 */
interface CreateLeadInput {
    /** Required by Rello (server returns 400 if empty). */
    firstName?: string;
    /** Required by Rello (server returns 400 if empty). */
    lastName?: string;
    email?: string;
    phone?: string;
    /** Lead source (e.g., "newsletter_studio", "the-home-scout"). */
    source?: string;
    /** Property type interest (e.g., "single_family", "condo"). */
    propertyType?: string;
    /** Price range interest. */
    priceRange?: string;
    /** Buying/selling timeline. */
    timeline?: string;
    /** Geographic areas of interest. */
    areas?: string[];
    /**
     * Agent/owner ID for lead assignment.
     * If omitted, Rello's routing engine assigns based on rules.
     * This is the Rello User ID of the agent, NOT an app-specific agent ID.
     */
    ownerId?: string;
    /** Tag IDs to apply on creation. */
    tagIds?: string[];
    /** MLO partner ID for lead sharing. */
    mloPartnerId?: string;
    /** Guest MLO ID for lead sharing. */
    providingGuestMLOId?: string;
    /** Trigger HomeReady app invite email on creation. */
    sendHomeReadyInvite?: boolean;
    /** Custom fields to set on the lead (initial value on create). For merging later, use setCustomFields(). */
    customFields?: Record<string, unknown>;
    /** HomeReady assessment score (0-100). */
    homeReadyScore?: number;
    /** Source detail (e.g., campaign name, referral context). */
    sourceDetail?: string;
    /** Explicit agent assignment — Rello User ID. Bypasses routing engine. */
    assignedAgentId?: string;
    /** MLO assignment — Rello User ID. */
    assignedMloId?: string;
    /** Which apps contributed data to this lead (e.g., ["HOMEREADY"]). */
    appsUsed?: string[];
}
interface UpdateLeadInput {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    source?: string;
    propertyType?: string;
    priceRange?: string;
    timeline?: string;
    areas?: string[];
    currentStage?: string;
    score?: number;
    homeReadyScore?: number;
    assignedAgentId?: string;
    assignedMloId?: string;
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
    /** Filter leads by assigned agent (Rello User ID). */
    agentId?: string;
}
/** Paginated leads response — preserves the pagination envelope from the server. */
interface LeadsPage {
    leads: Lead[];
    total: number;
    page: number;
    totalPages: number;
}
interface NurtureDecision {
    framework: string | null;
    contentDirection: string | null;
    contentPhase: string | null;
}
interface NurtureDecisionParams {
    limit?: number;
    action?: string;
}
interface FindByTagsInput {
    tagSlugs: string[];
    operator: "AND" | "OR";
    excludeTagSlugs?: string[];
    limit?: number;
    offset?: number;
}
interface FindByTagsResult {
    leads: Lead[];
    total: number;
}
interface BatchTagsResult {
    leadTags: Record<string, Array<{
        id: string;
        name: string;
        slug: string;
        category: string;
        color: string;
    }>>;
    found: number;
    requested: number;
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
     * Find a lead by exact email match within a tenant.
     *
     * Calls `GET /api/v1/leads?email={email}&search={email}` — sends BOTH the
     * new dedicated `email` query param AND the legacy `search` param so the
     * lookup works against both new and old Rello servers without coordinated
     * deployment:
     *   - New Rello (with `?email=` support): the server applies a
     *     case-insensitive exact match against the unique `(tenantId, email)`
     *     index and returns 0 or 1 lead. The redundant `search` filter is
     *     AND'd in but is a no-op once the email match has constrained the
     *     result to a single row.
     *   - Old Rello (pre Spoke App Integration Standard): the server silently
     *     strips the unknown `email` param and falls back to the legacy
     *     fuzzy `search` behavior — case-insensitive `contains` across
     *     firstName/lastName/email. The client-side exact-match filter below
     *     then validates the result for dedup safety.
     *
     * The dual-param send is a transition aid. It can be reduced to
     * `{ email }` once every Rello deployment has shipped the new query param
     * (target: after the v1.x.y rollout completes).
     *
     * Returns null when no lead with that exact email exists.
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
    /**
     * List leads with the full pagination envelope.
     *
     * GET /api/v1/leads
     *
     * Unlike list() which returns Lead[], this preserves { leads, total, page, totalPages }
     * for callers that need pagination metadata (e.g., Newsletter Studio's lead browser).
     */
    listWithPagination(tenantId: string, params?: ListLeadsParams): Promise<LeadsPage>;
    applyTags(tenantId: string, id: string, tags: string[]): Promise<void>;
    setCustomFields(tenantId: string, id: string, fields: Record<string, unknown>): Promise<void>;
    getConversionScore(tenantId: string, id: string): Promise<ConversionScore>;
    /**
     * Remove tags from a lead by tag name.
     *
     * DELETE /api/v1/leads/:id/tags
     *
     * Sends tag names in the request body. The v1 handler resolves names to IDs
     * and removes each matching tag from the lead.
     */
    removeTags(tenantId: string, id: string, tags: string[]): Promise<void>;
    /**
     * Fetch recent Milo nurture decisions for a lead.
     *
     * GET /api/v1/leads/:id/nurture-decisions
     *
     * Used by Newsletter Studio's editorial pass (C3) to provide decision history
     * context to Milo when generating personalized content.
     * Returns empty array on 404 (lead has no decisions yet).
     */
    getNurtureDecisions(tenantId: string, id: string, params?: NurtureDecisionParams): Promise<NurtureDecision[]>;
    /**
     * Query leads by tag combinations (AND/OR with optional exclusions).
     *
     * POST /api/v1/leads/by-tags
     *
     * Used for audience segmentation in Newsletter Studio's smart content matching.
     */
    findByTags(tenantId: string, input: FindByTagsInput): Promise<FindByTagsResult>;
    /**
     * Fetch tags for multiple leads in a single call.
     *
     * PUT /api/v1/leads/batch/tags
     *
     * Returns a map of leadId → Tag[] for all found leads.
     * Leads not found are silently omitted from the result.
     * Uses PUT (not GET) because the leadIds array can exceed URL length limits.
     */
    getBatchTags(tenantId: string, leadIds: string[]): Promise<BatchTagsResult>;
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
    leadId: string;
    tenantId: string;
    eventType: string;
    sourceApp: string;
    actorType: string;
    actorId: string | null;
    title: string | null;
    description: string | null;
    eventData: Record<string, unknown>;
    visibility: string;
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
interface Journey {
    id: string;
    name: string;
    slug?: string;
    description?: string;
    status: string;
    isActive: boolean;
    isTemplate?: boolean;
}
interface JourneyListParams {
    isActive?: boolean;
    includeArchived?: boolean;
    search?: string;
}

declare class FlowsResource {
    private readonly transport;
    constructor(transport: Transport);
    enroll(tenantId: string, leadId: string, flowSlug: string, context?: Record<string, unknown>): Promise<Enrollment>;
}
declare class JourneysResource {
    private readonly transport;
    constructor(transport: Transport);
    /**
     * List available journeys for a tenant.
     *
     * GET /api/v1/journeys
     *
     * For API key callers, returns JourneyTemplate objects (platform-wide templates
     * available to the tenant). For session callers, returns tenant-specific journeys.
     */
    list(tenantId: string, params?: JourneyListParams): Promise<Journey[]>;
    /**
     * Enroll a lead into a journey by slug.
     *
     * POST /api/v1/journeys/enroll
     *
     * The server resolves the slug to the tenant's journey instance
     * (or a cloned platform template).
     */
    enroll(tenantId: string, leadId: string, journeySlug: string, context?: Record<string, unknown>, goalContext?: EnrollJourneyInput["goalContext"]): Promise<Enrollment>;
    /**
     * Enroll a lead into a journey by database ID.
     *
     * POST /api/v1/journeys/enroll
     *
     * Use this when you have the journey's database ID (e.g., from a previous
     * journeys.list() call). The server verifies the journey belongs to the
     * tenant and is active.
     */
    enrollById(tenantId: string, leadId: string, journeyId: string, context?: Record<string, unknown>): Promise<Enrollment>;
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

/** Info about a registered platform app, returned by the app registry endpoint. */
interface AppInfo {
    /** Unique slug identifier (e.g., "property-engine"). */
    slug: string;
    /** Human-readable name (e.g., "Property Engine"). */
    name: string;
    /** Production base URL (e.g., "https://property-engine-production.up.railway.app"). Null if not configured. */
    baseUrl: string | null;
    /** Health check URL. Null if not configured. */
    healthUrl: string | null;
    /** App status: "STABLE", "BETA", etc. DEVELOPMENT/DEPRECATED/RETIRED are not returned (404). */
    status: string;
    /** Normalized source key for signal routing (e.g., "PROPERTY_ENGINE"). Null if not set. */
    appSourceKey: string | null;
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
 * Platform resource — app registry lookups and service resolution.
 *
 * Enables spoke apps to discover service URLs from Rello instead of
 * hardcoded env vars. Results are cached for 5 minutes.
 */
declare class PlatformResource {
    private readonly transport;
    /** In-memory cache: slug → { app, expiresAt }. */
    private readonly appCache;
    /**
     * Cached ServiceClient instances keyed by slug. Invalidated when the
     * corresponding AppInfo cache expires (baseUrl might have changed).
     * Sharing a ServiceClient per slug means the circuit breaker state
     * persists across calls — if a service goes down, all callers see
     * the open breaker instead of each getting a fresh one.
     */
    private readonly serviceCache;
    constructor(transport: Transport);
    /**
     * Look up a registered platform app by slug.
     *
     * Calls `GET /api/v1/platform/apps/{slug}` on cache miss or stale.
     * Only returns STABLE and BETA apps — DEVELOPMENT/DEPRECATED/RETIRED
     * return RelloNotFoundError (404).
     *
     * @throws {RelloNotFoundError} If the app doesn't exist or isn't production-ready.
     *
     * @example
     *   const pe = await rello.platform.getApp("property-engine");
     *   console.log(pe.baseUrl); // "https://property-engine-production.up.railway.app"
     */
    getApp(slug: string): Promise<AppInfo>;
    /**
     * Resolve a ServiceClient for a registered platform app.
     *
     * Looks up the app's baseUrl from the registry and creates a ServiceClient
     * with retry + circuit breaker. The ServiceClient uses the same API key
     * as the RelloClient — spoke-to-spoke auth is validated by the receiving
     * app (which fetches authorized key hashes from Rello's service-keys endpoint).
     *
     * @throws {Error} If the app has no baseUrl configured.
     * @throws {RelloNotFoundError} If the app doesn't exist or isn't production-ready.
     *
     * @example
     *   const pe = await rello.platform.resolveService("property-engine");
     *   const data = await pe.get("/api/lookups/123");
     */
    resolveService(slug: string): Promise<ServiceClient>;
}

interface UpdateAgentInput {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    slug?: string;
    photoUrl?: string;
    bio?: string;
    brokerage?: string;
    brokerageLogoUrl?: string;
    licenseNumber?: string;
    nmlsNumber?: string;
    role?: string;
    status?: string;
}
interface Agent {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    slug: string | null;
    photoUrl: string | null;
    bio: string | null;
    brokerage: string | null;
    brokerageLogoUrl: string | null;
    licenseNumber: string | null;
    nmlsNumber: string | null;
    role: string;
    status: string;
    teamName: string | null;
}

declare class AgentsResource {
    private readonly transport;
    constructor(transport: Transport);
    /**
     * Update an agent's profile in Rello.
     *
     * PATCH /api/v1/agents/:agentId
     *
     * Used by spoke apps to push local profile changes back to the hub
     * (e.g., Newsletter Studio syncing agent bios, Home Scout syncing photos).
     */
    update(tenantId: string, agentId: string, data: UpdateAgentInput): Promise<Agent>;
}

interface Tag {
    id: string;
    name: string;
    slug: string;
    category: string | null;
    color: string | null;
    leadCount: number;
}
interface TagsListParams {
    category?: string;
    search?: string;
    includeArchived?: boolean;
}
interface TagSearchParams {
    query?: string;
    category?: string;
    limit?: number;
}

declare class TagsResource {
    private readonly transport;
    constructor(transport: Transport);
    /**
     * List all tags for a tenant.
     *
     * GET /api/v1/tags
     */
    list(tenantId: string, params?: TagsListParams): Promise<Tag[]>;
    /**
     * Search tags by name with lead counts.
     *
     * GET /api/v1/tags/search
     *
     * Performs fuzzy matching on tag name and slug.
     */
    search(tenantId: string, params?: TagSearchParams): Promise<Tag[]>;
}

interface SegmentRules {
    includeTags: string[];
    excludeTags?: string[];
    operator: "AND" | "OR";
}
interface Segment {
    id: string;
    name: string;
    rules: SegmentRules;
    createdAt: string;
    updatedAt: string;
}
interface CreateSegmentInput {
    name: string;
    rules: SegmentRules;
}

declare class SegmentsResource {
    private readonly transport;
    constructor(transport: Transport);
    /**
     * List saved segments for a tenant.
     *
     * GET /api/v1/segments
     */
    list(tenantId: string): Promise<Segment[]>;
    /**
     * Create a new saved segment.
     *
     * POST /api/v1/segments
     */
    create(tenantId: string, data: CreateSegmentInput): Promise<Segment>;
}

interface MiloOptimizationInput {
    newsletterId: string;
    flowId?: string;
    leadIds?: string[];
    articles?: Array<{
        id: string;
        title: string;
        summary?: string;
        topics?: string[];
    }>;
    optimizationGoals?: {
        prioritize?: "opens" | "clicks" | "engagement";
        targetAudience?: string[];
    };
    mode?: string;
    currentScheduledTime?: string;
    subject?: string;
    content?: string;
    recipientCount?: number;
}
interface MiloOptimizationResponse {
    success: boolean;
    suggestedSubject?: string;
    suggestedSendTime?: string;
    contentRecommendations?: string[];
    estimatedOpenRate?: number;
    [key: string]: unknown;
}
interface MiloContentInput {
    leadId: string;
    newsletterId?: string;
    articles: Array<{
        id: string;
        title: string;
        summary?: string;
        topics?: string[];
    }>;
    customContext?: Record<string, unknown>;
}
interface MiloContentResponse {
    success: boolean;
    selectedArticles: string[];
    reasoning: string;
    [key: string]: unknown;
}

declare class MiloResource {
    private readonly transport;
    constructor(transport: Transport);
    /**
     * Get AI optimization suggestions for a newsletter.
     *
     * POST /api/v1/milo/optimize-newsletter
     *
     * Returns subject line suggestions, optimal send time,
     * content recommendations, and estimated open rate.
     */
    optimizeNewsletter(tenantId: string, data: MiloOptimizationInput): Promise<MiloOptimizationResponse>;
    /**
     * Get AI content selection for per-lead newsletter personalization.
     *
     * POST /api/v1/milo/select-content
     *
     * Given a lead and a set of available articles, returns which articles
     * are most relevant to the lead along with reasoning.
     */
    selectContent(tenantId: string, data: MiloContentInput): Promise<MiloContentResponse>;
}

interface LeadShareOwner {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
}
interface LeadShareLead {
    id: string;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    stage: string;
    score: number;
    owner: LeadShareOwner;
    tags?: Array<{
        tag: {
            id: string;
            name: string;
            slug: string;
            color: string;
        };
    }>;
}
interface LeadShare {
    id: string;
    leadId: string;
    guestMLOId?: string;
    sharedWithTenantId?: string;
    permission: "none" | "notify" | "limited" | "full";
    allowMLONewsletters: boolean;
    autoShared: boolean;
    createdAt: string;
    lead: LeadShareLead;
    sharedBy: LeadShareOwner;
}
interface LeadSharesListParams {
    guestMLOId?: string;
    permission?: string;
    allowMLONewsletters?: boolean;
    includeRevoked?: boolean;
    limit?: number;
    offset?: number;
}

declare class LeadSharesResource {
    private readonly transport;
    constructor(transport: Transport);
    /**
     * List lead shares for a tenant.
     *
     * GET /api/v1/lead-shares
     *
     * Supports filtering by guest MLO, permission level, and newsletter opt-in.
     * Returns shares with nested lead and sharedBy data.
     */
    list(tenantId: string, params?: LeadSharesListParams): Promise<{
        shares: LeadShare[];
        total: number;
    }>;
}

interface TeamAgent {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    role: string;
    status: string;
    slug?: string;
    joinedAt?: string;
    lastActiveAt?: string;
    leadCount?: number;
    openDealsCount?: number;
    closedDealsThisMonth?: number;
}
interface TeamStats {
    agentCount: number;
    leadCount: number;
    activeLeads: number;
    totalAgents?: number;
    activeAgents?: number;
    newslettersSentThisMonth?: number;
    avgOpenRate?: number;
    avgClickRate?: number;
}

declare class TeamResource {
    private readonly transport;
    constructor(transport: Transport);
    /**
     * List all agents in the tenant's team.
     *
     * GET /api/v1/team/agents
     */
    listAgents(tenantId: string): Promise<TeamAgent[]>;
    /**
     * Get a single team agent by ID.
     *
     * GET /api/v1/team/agents/:agentId
     */
    getAgent(tenantId: string, agentId: string): Promise<TeamAgent>;
    /**
     * Get aggregated team statistics.
     *
     * GET /api/v1/team/stats
     */
    getStats(tenantId: string): Promise<TeamStats>;
}

interface ReportIngestInput {
    slug: string;
    date: string;
    metrics: Record<string, number>;
}

declare class ReportsResource {
    private readonly transport;
    constructor(transport: Transport);
    /**
     * Ingest a report (daily stats, etc.) into Rello.
     *
     * POST /api/v1/reports/ingest
     *
     * Fire-and-forget from the caller's perspective — the report is
     * stored for dashboard display and trend analysis.
     */
    ingest(tenantId: string, data: ReportIngestInput): Promise<void>;
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
    readonly platform: PlatformResource;
    readonly agents: AgentsResource;
    readonly tags: TagsResource;
    readonly segments: SegmentsResource;
    readonly milo: MiloResource;
    readonly leadShares: LeadSharesResource;
    readonly team: TeamResource;
    readonly reports: ReportsResource;
    constructor(config?: RelloClientConfig);
    /**
     * Resolve a ServiceClient for another platform app by slug.
     *
     * Looks up the app's URL from Rello's registry (cached 5 min) and returns
     * a ServiceClient with retry + circuit breaker. Eliminates the need for
     * per-service URL env vars.
     *
     * @example
     *   const pe = await rello.service("property-engine");
     *   const data = await pe.get("/api/lookups/123");
     */
    service(slug: string): Promise<ServiceClient>;
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
 * Shared provisioning payload types for Rello ↔ spoke app communication.
 *
 * These schemas define the EXACT shapes that flow across the HTTP boundary
 * when Rello provisions tenants/agents into spoke apps. Both the Rello
 * sender and spoke receivers should validate against these schemas.
 *
 * PROVISIONING-AUDIT-2026-04-08: This file was created to close the
 * "type lies across HTTP boundaries" root-cause finding (Stage 7 #5).
 * Prior to this, each spoke had its own type definitions that had drifted
 * from what Rello actually sends, causing 8+ CRITICALs across 3 spokes.
 *
 * Schema updates MUST be coordinated: changing a field here requires
 * updating the Rello sender AND rebuilding every spoke that imports it.
 * CI will catch mismatches at build time.
 */

/**
 * Agent fields sent by Rello in provisioning payloads.
 *
 * This is the CANONICAL shape. Spoke receivers must NOT assume fields
 * beyond what's listed here (e.g., HH's old `name` field or `territories`
 * were never sent by Rello — they were type lies).
 */
declare const provisionedAgentSchema: z.ZodObject<{
    relloAgentId: z.ZodString;
    email: z.ZodString;
    firstName: z.ZodString;
    lastName: z.ZodString;
    slug: z.ZodString;
    role: z.ZodString;
    phone: z.ZodNullable<z.ZodString>;
    photoUrl: z.ZodOptional<z.ZodString>;
    bio: z.ZodOptional<z.ZodString>;
    title: z.ZodOptional<z.ZodString>;
    tagline: z.ZodOptional<z.ZodString>;
    brokerageName: z.ZodOptional<z.ZodString>;
    brokerageLogoUrl: z.ZodOptional<z.ZodString>;
    brokerageLicenseNumber: z.ZodOptional<z.ZodString>;
    licenseNumber: z.ZodOptional<z.ZodString>;
    licenseState: z.ZodOptional<z.ZodString>;
    nmlsNumber: z.ZodOptional<z.ZodString>;
    websiteUrl: z.ZodOptional<z.ZodString>;
    applicationUrl: z.ZodOptional<z.ZodString>;
    social: z.ZodOptional<z.ZodUnknown>;
    mloName: z.ZodOptional<z.ZodString>;
    mloNmls: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type ProvisionedAgent = z.infer<typeof provisionedAgentSchema>;
declare const tenantEnablePayloadSchema: z.ZodObject<{
    action: z.ZodLiteral<"enable">;
    relloTenantId: z.ZodString;
    tenant: z.ZodObject<{
        name: z.ZodString;
        slug: z.ZodString;
        logoUrl: z.ZodNullable<z.ZodString>;
        primaryColor: z.ZodNullable<z.ZodString>;
        physicalAddress: z.ZodNullable<z.ZodString>;
        applicationUrl: z.ZodNullable<z.ZodString>;
        type: z.ZodString;
        plan: z.ZodString;
    }, z.core.$strip>;
    agents: z.ZodArray<z.ZodObject<{
        relloAgentId: z.ZodString;
        email: z.ZodString;
        firstName: z.ZodString;
        lastName: z.ZodString;
        slug: z.ZodString;
        role: z.ZodString;
        phone: z.ZodNullable<z.ZodString>;
        photoUrl: z.ZodOptional<z.ZodString>;
        bio: z.ZodOptional<z.ZodString>;
        title: z.ZodOptional<z.ZodString>;
        tagline: z.ZodOptional<z.ZodString>;
        brokerageName: z.ZodOptional<z.ZodString>;
        brokerageLogoUrl: z.ZodOptional<z.ZodString>;
        brokerageLicenseNumber: z.ZodOptional<z.ZodString>;
        licenseNumber: z.ZodOptional<z.ZodString>;
        licenseState: z.ZodOptional<z.ZodString>;
        nmlsNumber: z.ZodOptional<z.ZodString>;
        websiteUrl: z.ZodOptional<z.ZodString>;
        applicationUrl: z.ZodOptional<z.ZodString>;
        social: z.ZodOptional<z.ZodUnknown>;
        mloName: z.ZodOptional<z.ZodString>;
        mloNmls: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
type TenantEnablePayload = z.infer<typeof tenantEnablePayloadSchema>;
declare const tenantDisablePayloadSchema: z.ZodObject<{
    action: z.ZodLiteral<"disable">;
    relloTenantId: z.ZodString;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type TenantDisablePayload = z.infer<typeof tenantDisablePayloadSchema>;
declare const tenantProvisioningPayloadSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    action: z.ZodLiteral<"enable">;
    relloTenantId: z.ZodString;
    tenant: z.ZodObject<{
        name: z.ZodString;
        slug: z.ZodString;
        logoUrl: z.ZodNullable<z.ZodString>;
        primaryColor: z.ZodNullable<z.ZodString>;
        physicalAddress: z.ZodNullable<z.ZodString>;
        applicationUrl: z.ZodNullable<z.ZodString>;
        type: z.ZodString;
        plan: z.ZodString;
    }, z.core.$strip>;
    agents: z.ZodArray<z.ZodObject<{
        relloAgentId: z.ZodString;
        email: z.ZodString;
        firstName: z.ZodString;
        lastName: z.ZodString;
        slug: z.ZodString;
        role: z.ZodString;
        phone: z.ZodNullable<z.ZodString>;
        photoUrl: z.ZodOptional<z.ZodString>;
        bio: z.ZodOptional<z.ZodString>;
        title: z.ZodOptional<z.ZodString>;
        tagline: z.ZodOptional<z.ZodString>;
        brokerageName: z.ZodOptional<z.ZodString>;
        brokerageLogoUrl: z.ZodOptional<z.ZodString>;
        brokerageLicenseNumber: z.ZodOptional<z.ZodString>;
        licenseNumber: z.ZodOptional<z.ZodString>;
        licenseState: z.ZodOptional<z.ZodString>;
        nmlsNumber: z.ZodOptional<z.ZodString>;
        websiteUrl: z.ZodOptional<z.ZodString>;
        applicationUrl: z.ZodOptional<z.ZodString>;
        social: z.ZodOptional<z.ZodUnknown>;
        mloName: z.ZodOptional<z.ZodString>;
        mloNmls: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"disable">;
    relloTenantId: z.ZodString;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>], "action">;
type TenantProvisioningPayload = z.infer<typeof tenantProvisioningPayloadSchema>;
declare const agentProvisionPayloadSchema: z.ZodObject<{
    action: z.ZodEnum<{
        add: "add";
        update: "update";
        remove: "remove";
    }>;
    relloTenantId: z.ZodString;
    agent: z.ZodObject<{
        relloAgentId: z.ZodString;
        email: z.ZodString;
        firstName: z.ZodString;
        lastName: z.ZodString;
        slug: z.ZodString;
        role: z.ZodString;
        phone: z.ZodNullable<z.ZodString>;
        photoUrl: z.ZodOptional<z.ZodString>;
        bio: z.ZodOptional<z.ZodString>;
        title: z.ZodOptional<z.ZodString>;
        tagline: z.ZodOptional<z.ZodString>;
        brokerageName: z.ZodOptional<z.ZodString>;
        brokerageLogoUrl: z.ZodOptional<z.ZodString>;
        brokerageLicenseNumber: z.ZodOptional<z.ZodString>;
        licenseNumber: z.ZodOptional<z.ZodString>;
        licenseState: z.ZodOptional<z.ZodString>;
        nmlsNumber: z.ZodOptional<z.ZodString>;
        websiteUrl: z.ZodOptional<z.ZodString>;
        applicationUrl: z.ZodOptional<z.ZodString>;
        social: z.ZodOptional<z.ZodUnknown>;
        mloName: z.ZodOptional<z.ZodString>;
        mloNmls: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    agentProfile: z.ZodOptional<z.ZodObject<{
        specialtySentence: z.ZodOptional<z.ZodString>;
        experienceStatement: z.ZodOptional<z.ZodString>;
        typicalClient: z.ZodOptional<z.ZodUnknown>;
        areasServed: z.ZodOptional<z.ZodUnknown>;
        designations: z.ZodOptional<z.ZodUnknown>;
        emailTone: z.ZodOptional<z.ZodString>;
        soloOrTeam: z.ZodOptional<z.ZodString>;
        preferredContactMethod: z.ZodOptional<z.ZodString>;
        calendarLink: z.ZodOptional<z.ZodString>;
        aboutMeFacts: z.ZodOptional<z.ZodUnknown>;
        avoidTopics: z.ZodOptional<z.ZodUnknown>;
        emphasizeTopics: z.ZodOptional<z.ZodUnknown>;
        sensitiveTopics: z.ZodOptional<z.ZodUnknown>;
        introductionDraft: z.ZodOptional<z.ZodString>;
        signoffStyle: z.ZodOptional<z.ZodString>;
        successStorySeeds: z.ZodOptional<z.ZodUnknown>;
        sendFrequency: z.ZodOptional<z.ZodString>;
        newsletterTemplateId: z.ZodOptional<z.ZodString>;
        brandColors: z.ZodOptional<z.ZodUnknown>;
        leadSourceContext: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$strip>>;
    wizardAnswers: z.ZodOptional<z.ZodArray<z.ZodObject<{
        questionId: z.ZodString;
        question: z.ZodString;
        answer: z.ZodUnknown;
    }, z.core.$strip>>>;
}, z.core.$strip>;
type AgentProvisionPayload = z.infer<typeof agentProvisionPayloadSchema>;
/**
 * Parse and validate an incoming tenant provisioning request body.
 * Returns the typed payload on success, or an error message on failure.
 *
 * Usage in a spoke receiver:
 * ```ts
 * const result = parseTenantPayload(await req.json());
 * if (!result.success) return badRequestResponse(result.error);
 * const payload = result.data;
 * ```
 */
declare function parseTenantPayload(body: unknown): {
    success: true;
    data: TenantProvisioningPayload;
} | {
    success: false;
    error: string;
};
/**
 * Parse and validate an incoming agent provisioning request body.
 */
declare function parseAgentPayload(body: unknown): {
    success: true;
    data: AgentProvisionPayload;
} | {
    success: false;
    error: string;
};

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

export { type Agent, type AgentProvisionPayload, type AppInfo, type BatchTagsResult, type BillingStatus, type CanSendInput, type CanSendResult, type CheckoutInput, type ConversionScore, type CreateActivityInput, type CreateEventInput, type CreateLeadInput, type CreateSegmentInput, type EffectiveSettings, type EmitSignalBatchResult, type EmitSignalInput, type EnrollFlowInput, type EnrollJourneyInput, type Enrollment, type EntitlementResult, type Event, type FindByTagsInput, type FindByTagsResult, type Journey, type JourneyListParams, type Lead, type LeadShare, type LeadShareLead, type LeadShareOwner, type LeadSharesListParams, type LeadsPage, type ListLeadsParams, type MiloContentInput, type MiloContentResponse, type MiloOptimizationInput, type MiloOptimizationResponse, type NurtureDecision, type NurtureDecisionParams, type PlatformCaller, type PlatformKeyValidatorConfig, type ProvisionedAgent, RelloAuthError, RelloClient, type RelloClientConfig, RelloError, RelloForbiddenError, RelloNotFoundError, RelloRateLimitError, RelloUnavailableError, RelloValidationError, type ReportIngestInput, type Segment, type SegmentRules, ServiceClient, type ServiceClientConfig, type Tag, type TagSearchParams, type TagsListParams, type TeamAgent, type TeamStats, type TenantDisablePayload, type TenantEnablePayload, type TenantProvisioningPayload, type UpdateAgentInput, type UpdateLeadInput, type UsageInput, agentProvisionPayloadSchema, createPlatformKeyValidator, createRelloClient, createServiceClient, parseAgentPayload, parseTenantPayload, provisionedAgentSchema, tenantDisablePayloadSchema, tenantEnablePayloadSchema, tenantProvisioningPayloadSchema };
