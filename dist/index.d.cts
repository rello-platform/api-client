import { AppSlug } from '@rello-platform/slugs';
import { z } from 'zod';
import { PermissionSlug } from '@rello-platform/permissions';

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
        /** Override the default `/api/v1` prefix (e.g., `/api` for non-v1 routes). */
        apiPrefix?: string;
    }): Promise<T>;
    private doFetch;
    get<T>(path: string, tenantId: string, query?: Record<string, string | undefined>, timeout?: TimeoutPreset): Promise<T>;
    post<T>(path: string, tenantId: string, body: unknown, timeout?: TimeoutPreset): Promise<T>;
    patch<T>(path: string, tenantId: string, body: unknown, timeout?: TimeoutPreset): Promise<T>;
    delete<T>(path: string, tenantId: string, timeout?: TimeoutPreset): Promise<T>;
    /**
     * GET a non-v1 route (uses `/api` prefix instead of `/api/v1`).
     */
    getRaw<T>(path: string, tenantId: string, query?: Record<string, string | undefined>, timeout?: TimeoutPreset): Promise<T>;
    /**
     * POST to a non-v1 route (uses `/api` prefix instead of `/api/v1`).
     */
    postRaw<T>(path: string, tenantId: string, body?: unknown, timeout?: TimeoutPreset): Promise<T>;
}

/**
 * Entity-shape classification for a Lead. Mirrors the EntityType union
 * exported from `@rello-platform/lead-entity` (the canonical source of truth
 * for the classifier + normalizer pure-functions). Duplicated here as a
 * literal to avoid a circular package dependency at this layer; a follow-up
 * bump may fold this into a named import once consumer pin orderings settle.
 */
type EntityType = "INDIVIDUAL" | "LLC" | "PARTNERSHIP" | "TRUST" | "CORPORATION" | "OTHER";
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
    /**
     * HomeReady assessment score (0-100). Mirrors Prisma `Lead.homeReadyScore` (Int?).
     * Always present in `GET /api/v1/leads/[id]` response (Rello returns the full Prisma
     * row); null when the lead has not yet been HomeReady-assessed.
     */
    homeReadyScore: number | null;
    /**
     * ISO-8601 timestamp of the last meaningful re-evaluation (HR assessment, HH rescore,
     * positive call, score change ≥5). Mirrors Prisma `Lead.lastMeaningfulEvalAt`
     * (DateTime?), serialized to a JSON string by `NextResponse.json`. Null when the
     * lead has never had a meaningful re-evaluation event.
     */
    lastMeaningfulEvalAt: string | null;
    /**
     * Rello User ID of the explicitly-assigned agent. Mirrors Prisma
     * `Lead.assignedAgentId` (String?). Null when the lead has no explicit agent
     * assignment; spoke consumers typically prefer this over `ownerId` for
     * agent-routing logic and fall back to `ownerId` when null.
     */
    assignedAgentId: string | null;
    /**
     * Rello User ID of the assigned MLO partner. Mirrors Prisma `Lead.assignedMloId`
     * (String?). Null when the lead has no MLO co-assignment.
     */
    assignedMloId: string | null;
    /**
     * Rello User ID of the lead's owner (creator or routing-engine assignment).
     * Mirrors Prisma `Lead.ownerId` (String?). Null when the lead is unassigned
     * (rare — most flows guarantee an owner via routing).
     */
    ownerId: string | null;
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
    /** Canonical Format-2 AppSlug identifying the originating app (e.g., "home-ready", "harvest-home"). Rello rejects legacy Format-3 UPPERCASE-concat and Format-4 UPPERCASE_UNDERSCORE values at the zod boundary. */
    source?: AppSlug;
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
    /** Which apps contributed data to this lead, as canonical Format-2 AppSlugs (e.g., ["home-ready"]). */
    appsUsed?: AppSlug[];
    /**
     * Entity-shape classification. Defaults to INDIVIDUAL on the Rello server
     * when omitted. When non-INDIVIDUAL, `entityName` must accompany this
     * value; for INDIVIDUAL, `entityName` must be omitted. The classifier +
     * normalizer pure-functions live in `@rello-platform/lead-entity`.
     */
    entityType?: EntityType;
    /**
     * Raw entity name as captured from the upstream source (BYOL CSV row,
     * intake API payload, manual entry). Preserves casing + punctuation for
     * display. Required when `entityType !== "INDIVIDUAL"`. Rello derives
     * `entityNameNormalized` server-side via `normalizeEntityName`.
     */
    entityName?: string;
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
    /**
     * Filter leads by the OWNING agent. This is the Rello **User.id** of the
     * owning MLO (the same value you pass as `ownerId` on `create`), NOT an
     * app-specific agent id. Forwarded to the server as `?ownerId=`, which is
     * the canonical server-side owner filter (Rello `getLeads` filters on
     * `Lead.ownerId`).
     */
    ownerId?: string;
    /**
     * @deprecated Use `ownerId` instead — `agentId` is a back-compat alias for
     * the same Rello User.id and is forwarded to the server as `?ownerId=`.
     * Earlier SDK versions forwarded this as `?agentId=`, which the Rello server
     * silently ignored (it has always read `ownerId`), so the previous param was
     * a no-op no caller can depend on; this release repairs it to the working
     * `ownerId` filter. When both `ownerId` and `agentId` are supplied, `ownerId`
     * wins.
     */
    agentId?: string;
    /**
     * Filter leads by their originating app slug — the canonical
     * lowercase-hyphenated AppSlug stored on `Lead.source` (e.g.
     * "pathfinder-pro", "home-ready"). Forwarded as `?source=`; the server
     * applies an exact match. Lets a consumer fetch only the leads its own app
     * originated.
     */
    source?: string;
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
/** Response from GET /api/leads/[id]/context-cache */
interface ContextCacheResponse {
    exists: boolean;
    leadId: string;
    narrative?: string;
    emotionalState?: string;
    sourcesPresent?: number;
    sourcesTotal?: number;
    computedAt?: string;
    isStale?: boolean;
    freshnessLabel?: string;
    refreshReason?: string | null;
}
/** Input for POST /api/v1/leads/:id/offline-interactions */
interface RecordOfflineInteractionInput {
    /** Interaction type. One of: "call", "meeting", "showing", "open_house", "note". */
    type: "call" | "phone_call" | "meeting" | "showing" | "open_house" | "note";
    /** Interaction outcome (required). */
    outcome: string;
    /** Free-text notes (optional). */
    notes?: string;
    /** Duration in minutes (optional). */
    duration?: number;
    /** Sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "MIXED". Defaults to NEUTRAL. */
    sentiment?: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "MIXED";
    /** ISO timestamp of when the interaction occurred. Defaults to now. */
    occurredAt?: string;
    /** Source app slug (optional). */
    source?: string;
    /** Agent ID override (optional — defaults to lead's assigned agent). */
    agentId?: string;
}
/** Response from POST /api/v1/leads/:id/offline-interactions */
interface OfflineInteractionResponse {
    interaction: {
        id: string;
        tenantId: string;
        leadId: string;
        agentId: string;
        type: string;
        sentiment: string;
        duration: number | null;
        notes: string | null;
        outcome: string;
        occurredAt: string;
        createdAt: string;
        [key: string]: unknown;
    };
}
/**
 * A row from Rello's `ClosingTransaction` model, filtered to
 * `status: "CLOSING_COMPLETED"` and projected to Hub-rendered fields.
 *
 * Source: `GET /api/leads/:id/closed-loans` (Rello endpoint shipped
 * for HHUB Phase 7 per B-04 amended lock — note `/api/` prefix, not
 * `/api/v1/` — read via `transport.getRaw`).
 *
 * `closedAt` falls back to `actualClosingDate` during the ARIVE writer
 * dual-populate transition window (Lock S-2). Both are ISO-8601 strings.
 */
interface ClosedLoan {
    id: string;
    lender: string | null;
    originalBalance: number | null;
    currentBalance: number | null;
    rate: number | null;
    termMonths: number | null;
    monthsRemaining: number | null;
    closedAt: string | null;
    propertyAddress: string;
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
     * Fetch the lead's Rello-platform-closed loans from the
     * `ClosingTransaction` model.
     *
     * GET /api/leads/:id/closed-loans (non-v1 route — uses `getRaw`)
     *
     * Server query: `status: "CLOSING_COMPLETED"`, ordered by `closedAt` desc
     * with `actualClosingDate` desc fallback. Returns null when no closed-loan
     * row exists for the lead (Hub then falls back to Flueid `hh_lien1_*`
     * customFields or the "unavailable" empty-state).
     *
     * Used by HS Hub data-assembly (`fetchMortgageBlock`) per HHUB B-04
     * amended lock — ClosingTransaction is highest-fidelity mortgage source
     * (real ARIVE LOS data); Flueid is secondary public-records fallback.
     */
    getClosedLoans(tenantId: string, id: string): Promise<ClosedLoan[] | null>;
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
    /**
     * Get the pre-computed context cache narrative for a lead.
     *
     * GET /api/leads/[id]/context-cache (non-v1 route)
     *
     * Returns the Haiku-polished narrative, emotional state, data source counts,
     * and freshness info. Used by the LeadStoryCard on the lead detail Overview tab.
     */
    getContextCache(tenantId: string, leadId: string): Promise<ContextCacheResponse>;
    /**
     * Record an offline interaction for a lead.
     *
     * POST /api/v1/leads/:id/offline-interactions
     *
     * Used by spoke apps to record phone calls, meetings, showings, open house
     * interactions, and notes that occurred outside the platform.
     */
    recordOfflineInteraction(tenantId: string, leadId: string, data: RecordOfflineInteractionInput): Promise<OfflineInteractionResponse>;
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

/**
 * PFP Gateway "Match my design" (Platform KA prompt 1419; Kelly D55: a $99
 * one-time charge per request): charge ONE one-time add-on to the tenant's
 * saved card when PathfinderPro asks. One contract for Rello's route and
 * PathfinderPro's caller.
 *
 *   POST /api/v1/billing/add-on/charge-once                  permission billing:addon-charge:write
 *   GET  /api/v1/billing/add-on/charge-once?requestId=<id>   permission billing:addon-charge:write
 *
 * (`billing:addon-charge:write`: @rello-platform/permissions v0.66.0.)
 *
 * Auth: `Authorization: Bearer <ApiKey>` (Rello's ApiKey table, targetApp RELLO),
 * then the add-on must belong to the calling app (callerOwnsAddOn). The tenant is
 * the key's own, or `X-Tenant-Id` for a tenant-null key; never a body.
 *
 * ONE CHARGE PER REQUEST ID. The request id is the idempotency key: the same id is
 * the same charge, replayed with the same answer; a new id is a new charge.
 *
 * THE AMOUNT IS NEVER THE CALLER'S. Rello charges the add-on's catalog price. The
 * caller sends `quoteCents`, the price it showed the person (the `price.once` it
 * read from GET /api/v1/billing/add-ons); a catalog price that is not that is a 409
 * `price_changed` and nothing is charged.
 *
 * ANSWERS (discriminated on `status`):
 *   200 charged   { chargeId, amountCents, paidAt }  the money was taken (also the replay of it)
 *   402 declined  { message }                        the card refused; nothing was taken
 *   202 unknown   { chargeId }                       Rello does not yet know. NEVER charge again:
 *                                                    GET by requestId until it settles
 *   200 manual    { reason }                         nothing was charged: the tenant has no Stripe
 *                                                    customer or no saved card. Tell the owner; they
 *                                                    settle it by hand
 * Refusals are `{ error }`: 409 price_changed | add_on_not_one_time, 404 add_on_not_found; the
 * 400/401/403 keep the client's existing shapes. A GET for a request id with no claim on the
 * caller's tenant is 404 (its body is `{ error: string }`).
 *
 * A network failure, a timeout or a 5xx after the POST left the process is NOT "declined" and NOT
 * "not charged": Rello may have taken the money. Treat it as unknown and GET by the same request id.
 */

/** The idempotency header the POST requires (Rello's v1 billing mutations all use this name): 8–128 characters, one per intended charge. */
declare const ADD_ON_CHARGE_ONCE_IDEMPOTENCY_HEADER = "X-Idempotency-Key";
/**
 * The same value under the unprefixed name. The client method sends both so a route that reads either
 * name sees the key. Rello's shared reader (readIdempotencyKey) reads X-Idempotency-Key.
 */
declare const ADD_ON_CHARGE_ONCE_IDEMPOTENCY_HEADER_ALIAS = "Idempotency-Key";
/** The spoke's request id, which is the idempotency key. Trimmed, 8–128 characters. */
declare const addOnChargeOnceRequestIdSchema: z.ZodString;
/** The POST body, strict: an amount, a tenant or a coupon from the caller is a 400. */
declare const addOnChargeOnceRequestSchema: z.ZodObject<{
    addOnId: z.ZodString;
    quoteCents: z.ZodNumber;
}, z.core.$strict>;
type AddOnChargeOnceRequest = z.infer<typeof addOnChargeOnceRequestSchema>;
/** The GET query, strict. */
declare const addOnChargeOnceQuerySchema: z.ZodObject<{
    requestId: z.ZodString;
}, z.core.$strict>;
type AddOnChargeOnceQuery = z.infer<typeof addOnChargeOnceQuerySchema>;
/** 200: the money was taken. `amountCents` is what Rello charged (integer cents). */
declare const addOnChargeOnceChargedSchema: z.ZodObject<{
    status: z.ZodLiteral<"charged">;
    chargeId: z.ZodString;
    amountCents: z.ZodNumber;
    paidAt: z.ZodString;
}, z.core.$strip>;
/** 402: the card refused. Nothing was taken. */
declare const addOnChargeOnceDeclinedSchema: z.ZodObject<{
    status: z.ZodLiteral<"declined">;
    message: z.ZodString;
}, z.core.$strip>;
/** 202: unknown. Never charge again; read the state by request id. */
declare const addOnChargeOnceUnknownSchema: z.ZodObject<{
    status: z.ZodLiteral<"unknown">;
    chargeId: z.ZodString;
}, z.core.$strip>;
/** Why nothing was charged. */
declare const ADD_ON_CHARGE_ONCE_MANUAL_REASONS: readonly ["no_stripe_customer", "no_payment_method"];
type AddOnChargeOnceManualReason = (typeof ADD_ON_CHARGE_ONCE_MANUAL_REASONS)[number];
/** 200: nothing was charged; the owner settles it by hand. */
declare const addOnChargeOnceManualSchema: z.ZodObject<{
    status: z.ZodLiteral<"manual">;
    reason: z.ZodEnum<{
        no_stripe_customer: "no_stripe_customer";
        no_payment_method: "no_payment_method";
    }>;
}, z.core.$strip>;
/** Every answer of the POST and the GET, discriminated on `status`. */
declare const addOnChargeOnceAnswerSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    status: z.ZodLiteral<"charged">;
    chargeId: z.ZodString;
    amountCents: z.ZodNumber;
    paidAt: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    status: z.ZodLiteral<"declined">;
    message: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    status: z.ZodLiteral<"unknown">;
    chargeId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    status: z.ZodLiteral<"manual">;
    reason: z.ZodEnum<{
        no_stripe_customer: "no_stripe_customer";
        no_payment_method: "no_payment_method";
    }>;
}, z.core.$strip>], "status">;
type AddOnChargeOnceAnswer = z.infer<typeof addOnChargeOnceAnswerSchema>;
type AddOnChargeOnceCharged = z.infer<typeof addOnChargeOnceChargedSchema>;
type AddOnChargeOnceDeclined = z.infer<typeof addOnChargeOnceDeclinedSchema>;
type AddOnChargeOnceUnknown = z.infer<typeof addOnChargeOnceUnknownSchema>;
type AddOnChargeOnceManual = z.infer<typeof addOnChargeOnceManualSchema>;
/**
 * The refusals the route names today (`{ error }` bodies, thrown by the client as RelloError):
 *   409 price_changed | add_on_not_one_time | add_on_not_priced (a ONE_TIME add-on with no one-time price)
 *   404 add_on_not_found
 *   422 request_id_in_use (one request id reused for a different add-on; nothing charged)
 *   409 request_id_ambiguous (GET only, a rare race)
 *   503 billing_unavailable (Stripe not configured; nothing claimed; retried by the transport on the same key)
 * v2.41.0 added the last four.
 */
declare const ADD_ON_CHARGE_ONCE_ERROR_CODES: readonly ["price_changed", "add_on_not_one_time", "add_on_not_found", "request_id_in_use", "request_id_ambiguous", "billing_unavailable", "add_on_not_priced"];
type AddOnChargeOnceErrorCode = (typeof ADD_ON_CHARGE_ONCE_ERROR_CODES)[number];
/**
 * A refusal body `{ error }`. `error` is a plain string and `.loose()` keeps any extra field, so a
 * later code never fails the parse; compare it with ADD_ON_CHARGE_ONCE_ERROR_CODES.
 */
declare const addOnChargeOnceErrorSchema: z.ZodObject<{
    error: z.ZodString;
}, z.core.$loose>;
type AddOnChargeOnceError = z.infer<typeof addOnChargeOnceErrorSchema>;

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
    /**
     * Charge ONE one-time add-on to the tenant's saved card, once per `requestId` (PFP Gateway "Match
     * my design"; contract and answers in ../types/addon-charge-once.ts).
     *
     * Resolves with the answer: `charged` (200), `manual` (200), `unknown` (202) or `declined` (402; an
     * answer, not an error). Throws on everything else: RelloError 409 (`price_changed` |
     * `add_on_not_one_time`; parse `err.body` with addOnChargeOnceErrorSchema), RelloNotFoundError 404
     * (`add_on_not_found`), RelloValidationError / RelloAuthError / RelloForbiddenError, and
     * RelloUnavailableError or RelloError 5xx when the request failed in flight.
     *
     * ⚠ A throw from a request that left the process (timeout, network, 5xx) is NOT "not charged":
     * Rello may have taken the money. Call getOneTimeAddOnCharge with the same `requestId` and never
     * charge under a new one. A 200/202/402 body this client cannot read is thrown as a RelloError
     * carrying that status, never returned as an answer.
     *
     * The same `requestId` is sent on every transport retry, so a retried POST is the same charge.
     */
    chargeOneTimeAddOn(tenantId: string, input: AddOnChargeOnceRequest, requestId: string): Promise<AddOnChargeOnceAnswer>;
    /**
     * The state of a charge by the request id it was made under. Resolves with the same answers as
     * chargeOneTimeAddOn (a 402 `declined` included). Throws RelloNotFoundError (404) when the
     * caller's tenant has no charge under that request id.
     */
    getOneTimeAddOnCharge(tenantId: string, requestId: string): Promise<AddOnChargeOnceAnswer>;
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

/**
 * SPEC-PE-ADDRESS-NORMALIZE — typed contract for the
 * `POST /api/address-normalize` endpoint hosted by Property Engine.
 *
 * Consumers reach this surface via:
 *
 *   const pe = await rello.service("property-engine");
 *   const out = await pe.addressNormalize({ rawAddress: "..." }, tenantId);
 *
 * Spec body lives in iCloud:
 *   `RELLO TO BE BUILT/BUILD-|-FEATURE-ADDS/PE ADDRESS NORMALIZE/SPEC-PE-ADDRESS-NORMALIZE.md`
 *
 * Design lock — Parcel registry is platform-shared (NOT tenant-scoped); FIPS
 * resolution is via `FipsMapping`, not `Parcel.fips` (which doesn't exist).
 * `tenantId` is REQUIRED for auth + audit-logging only — it does NOT narrow
 * the Parcel match. Recorded in
 * `RELLO TO BE BUILT/APP REBUILDS/~DISCOVERED-PROMPTS/DONE/IMPL-AGENT-UNHALT-PE-ADDRESS-NORMALIZE-PARCEL-SCOPING-LOCK.md`.
 */
/** Free-form input variant — comma-separated address string. */
interface AddressNormalizeFreeFormInput {
    rawAddress: string;
    /** Optional 2-letter / full-name state override when rawAddress lacks one. */
    state?: string | null;
}
/** Pre-split input variant — caller already has structured fields. */
interface AddressNormalizePreSplitInput {
    streetAddress: string;
    city: string;
    state: string;
    zipCode: string;
    unit?: string | null;
    county?: string | null;
    apn?: string | null;
}
type AddressNormalizeRequest = AddressNormalizeFreeFormInput | AddressNormalizePreSplitInput;
type AddressNormalizeMatchedBy = "apn-county" | "address-fallback" | "none";
interface AddressNormalizeResponse {
    success: true;
    /** Human-readable canonical form: "<street>, <city>, <STATE> <zip>". */
    canonicalAddress: string;
    normalizedComponents: {
        streetAddress: string;
        city: string;
        state: string;
        zipCode: string;
        unit: string | null;
        county: string | null;
        apn: string | null;
    };
    parcelResolution: {
        /** Platform-shared Parcel.id; null when no natural-key match. */
        parcelId: string | null;
        /** 5-digit county FIPS via `FipsMapping(zipCode)`; null when no mapping exists. */
        fips: string | null;
        matchedBy: AddressNormalizeMatchedBy;
    };
}

/**
 * SPEC-PE-PFP-PROPERTY-AUTOFILL — typed contract for the
 * `POST /api/property-autofill` endpoint hosted by Property Engine.
 *
 * Consumers reach this surface via:
 *
 *   const pe = await rello.service("property-engine");
 *   const out = await pe.propertyAutofill(
 *     { rawAddress: "123 Main St, Anytown, UT 84101", selectedFields: ["beds", "baths"] },
 *     tenantId,
 *   );
 *
 * Spec body lives in iCloud:
 *   `RELLO TO BE BUILT/APP REBUILDS/PROPERTY ENGINE/SPEC-PE-PFP-PROPERTY-AUTOFILL.md`
 *
 * Unified composer endpoint that wraps:
 *   1. Address normalize + Parcel natural-key resolution
 *   2. MLS listing lookup via Property.parcelId (with address-fallback)
 *   3. (Optional) ATTOM enrichment passthrough
 *
 * Eliminates 2-3 sequential round-trips for cross-app callers (PFP Cockpit
 * Section 2, future spokes).
 *
 * TRID guardrail (Design Call #2 lock 2026-05-13):
 * Response describes the borrower's CURRENT RESIDENCE only — never implies
 * subject-property speculation. Consumers MUST NOT wire this to subject-
 * property intake. PFP's TRID stance is that subject-property addresses are
 * never captured pre-LOS-export (`subjectTBDIndicator: true`).
 *
 * Design locks (Build-KA disposition 2026-05-13):
 *   #1 — Unified endpoint is the locked path (§3.4 PFP-side composer REJECTED)
 *   #2 — TRID = current-residence-only
 *   #3 — Selected-fields cache: key (parcelId, sortedFieldKeys, includeAttom);
 *        sortedFieldKeys at cache-write time; 24h MLS / 7d ATTOM TTLs
 *   #4 — api-client extension (this file) ships in v2.18.0
 *
 * `tenantId` is REQUIRED — Property Engine returns 400 if the `X-Tenant-Id`
 * header is absent. Property data (Parcel + MLS listing + ATTOM) is
 * platform-shared / external-keyed; `tenantId` exists for the audit trail
 * dimension and to pass the receiver's auth gate (`lookups:read` permission).
 */
/**
 * Verbatim from PE `src/app/api/property-autofill/route.ts` lines 63-73.
 * Cache key at PE includes `sortedFieldKeys` per SPEC §3.2 Design Call #3.
 */
declare const PROPERTY_AUTOFILL_FIELD_KEYS: readonly ["beds", "baths", "sqft", "yearBuilt", "lotSizeSqft", "propertyType", "estimatedValue", "lastSaleDate", "lastSalePrice"];
type PropertyAutofillFieldKey = (typeof PROPERTY_AUTOFILL_FIELD_KEYS)[number];
/**
 * Mirrors Prisma enum `PropertyStatus` at PE `prisma/schema.prisma:1059-1067`.
 * Inlined as a string-literal union to avoid an `@prisma/client` dependency
 * in the api-client package.
 */
type PropertyAutofillPropertyStatus = "ACTIVE" | "PENDING" | "SOLD" | "WITHDRAWN" | "EXPIRED" | "COMING_SOON" | "OFF_MARKET";
/**
 * Mirrors Prisma enum `PropertyType` at PE `prisma/schema.prisma:1075-1084`.
 * Inlined as a string-literal union to avoid an `@prisma/client` dependency
 * in the api-client package.
 */
type PropertyAutofillPropertyType = "SINGLE_FAMILY" | "CONDO" | "TOWNHOUSE" | "MULTI_FAMILY" | "LAND" | "COMMERCIAL" | "MOBILE_HOME" | "OTHER";
/** Free-form input variant — comma-separated address string. */
interface PropertyAutofillFreeFormInput {
    rawAddress: string;
    /** Optional state override when rawAddress lacks one. */
    state?: string | null;
    includeMls?: boolean;
    includeAttom?: boolean;
    /** Caller-declared field whitelist; cache key includes sortedFieldKeys per SPEC §3.2 Design Call #3. */
    selectedFields?: PropertyAutofillFieldKey[];
}
/** Pre-split input variant — caller already has structured fields. */
interface PropertyAutofillPreSplitInput {
    streetAddress: string;
    city: string;
    state: string;
    zipCode: string;
    unit?: string | null;
    county?: string | null;
    apn?: string | null;
    includeMls?: boolean;
    includeAttom?: boolean;
    selectedFields?: PropertyAutofillFieldKey[];
}
type PropertyAutofillRequest = PropertyAutofillFreeFormInput | PropertyAutofillPreSplitInput;
interface PropertyAutofillListing {
    listingId: string;
    mlsNumber: string | null;
    status: PropertyAutofillPropertyStatus;
    listPrice: number | null;
    listDate: string | null;
    matchedBy: "parcel-id" | "address-fallback" | "none";
}
interface PropertyAutofillFieldShape {
    beds?: number | null;
    baths?: number | null;
    sqft?: number | null;
    yearBuilt?: number | null;
    lotSizeSqft?: number | null;
    propertyType?: PropertyAutofillPropertyType | null;
    estimatedValue?: number | null;
    lastSaleDate?: string | null;
    lastSalePrice?: number | null;
}
interface PropertyAutofillAttomSummary {
    attomId: number | null;
    yearBuilt: number | null;
    lotSizeSqft: number | null;
    buildingSqFt: number | null;
    estimatedValue: number | null;
    lastSaleDate: string | null;
    lastSalePrice: number | null;
}
interface PropertyAutofillResponseSuccess {
    success: true;
    canonicalAddress: string;
    normalizedComponents: {
        streetAddress: string;
        city: string;
        state: string;
        zipCode: string;
        unit: string | null;
        county: string | null;
        apn: string | null;
    };
    parcelResolution: {
        parcelId: string | null;
        fips: string | null;
        matchedBy: "apn-county" | "address-fallback" | "none";
    };
    listing: PropertyAutofillListing | null;
    propertyDetails: PropertyAutofillFieldShape | null;
    attom: PropertyAutofillAttomSummary | null;
    /**
     * Annual property tax (USD/year) for the borrower's CURRENT RESIDENCE,
     * resolved by address against Property Engine's statewide Utah SGID dataset
     * (DISPATCH-T3C / B-04; PE ships in this contract from v2.21.0). READ from the
     * persisted `Property.annualTax` (computed by PE's `annual-tax-compute` cron) —
     * never recomputed at request time.
     *
     * `null` when no SGID row matches the address OR the parcel is tax-exempt.
     * Consumers omit the tax line when null — a missing tax row is never an error.
     *
     * Resolved independently of `listing` / `propertyDetails` / `attom` and is
     * NOT gated by `selectedFields` (tax is not an MLS-derived selectable field).
     * Optional in the type so consumers pinned ahead of the PE deploy still
     * typecheck; PE always emits these keys once deployed.
     *
     * TRID note: this remains a CURRENT-RESIDENCE field — the tax of where the
     * borrower lives now. It MUST NOT be wired to subject-property intake.
     */
    taxAnnual?: number | null;
    /** Assessment / tax year for the matched SGID tax row; null when unmatched. */
    taxYear?: number | null;
    /** Assessed market value (USD) for the matched SGID tax row; null when unmatched. */
    taxAssessedValue?: number | null;
    cache: {
        hit: boolean;
        key: string | null;
    };
}
interface PropertyAutofillResponseError {
    success: false;
    error: string;
    code: "BAD_JSON" | "VALIDATION_ERROR" | "UNPARSEABLE_ADDRESS" | "NORMALIZE_FAILED" | "MLS_LOOKUP_FAILED" | "ATTOM_LOOKUP_FAILED";
    details?: unknown;
}
type PropertyAutofillResponse = PropertyAutofillResponseSuccess | PropertyAutofillResponseError;

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
    /**
     * SPEC-PE-ADDRESS-NORMALIZE — canonical address normalization +
     * platform-shared Parcel resolution + FipsMapping FIPS lookup.
     *
     * Only meaningful when this `ServiceClient` is bound to Property Engine
     * (e.g. via `rello.service("property-engine")`). Other targets will 404.
     *
     * `tenantId` is REQUIRED — Property Engine returns 400 if the
     * `X-Tenant-Id` header is absent. It does NOT narrow the Parcel result;
     * Parcel is a platform-shared registry. Use `tenantId` for the audit
     * trail dimension and to pass the receiver's auth gate.
     */
    addressNormalize(input: AddressNormalizeRequest, tenantId: string): Promise<AddressNormalizeResponse>;
    /**
     * SPEC-PE-PFP-PROPERTY-AUTOFILL — unified address-normalize + MLS lookup +
     * (optional) ATTOM enrichment with caller-declared selected-fields cache.
     *
     * Only meaningful when this `ServiceClient` is bound to Property Engine
     * (e.g. via `rello.service("property-engine")`). Other targets will 404.
     *
     * `tenantId` is REQUIRED — Property Engine returns 400 if the
     * `X-Tenant-Id` header is absent. Property data (parcel + listing + ATTOM)
     * is platform-shared / external-keyed; `tenantId` is for the audit trail
     * dimension and to pass the receiver's auth gate (lookups:read permission).
     *
     * TRID guardrail per Design Call #2: response describes borrower's
     * CURRENT RESIDENCE only — never implies subject-property speculation.
     */
    propertyAutofill(input: PropertyAutofillRequest, tenantId: string): Promise<PropertyAutofillResponse>;
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

/** Input for POST /api/auth/validate */
interface ValidateSessionInput {
    /** The rello_session token to validate. */
    token: string;
}
/** Tenant info returned from session validation. */
interface ValidatedTenant {
    id: string;
    name: string;
    type: string;
    slug: string | null;
}
/** User data returned from session validation. */
interface ValidatedUser {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    tenantId: string;
    tenant: ValidatedTenant | null;
}
/** Successful response from POST /api/auth/validate */
interface ValidateSessionResponse {
    success: true;
    data: ValidatedUser;
}
/** Error response from POST /api/auth/validate */
interface ValidateSessionError {
    success: false;
    error: string;
}

declare class AuthResource {
    private readonly transport;
    constructor(transport: Transport);
    /**
     * Validate a rello_session token for spoke apps.
     *
     * POST /api/auth/validate (non-v1 route)
     *
     * Spoke apps (The Oven, Home Scout, etc.) forward the session cookie and
     * receive the user/tenant context. Returns the user profile including
     * tenantId, role, and tenant metadata.
     *
     * @throws RelloAuthError if the token is invalid or expired.
     */
    validate(tenantId: string, input: ValidateSessionInput): Promise<ValidateSessionResponse>;
}

/** Input for POST /api/admin/ai/usage-log */
interface LogAiUsageInput {
    /** Calling app identifier (e.g., "home-stretch", "milo-engine"). */
    callerApp: string;
    /** API endpoint that was called. */
    endpoint: string;
    /** Prompt slug used (if applicable). */
    promptSlug?: string | null;
    /** AI model used (e.g., "claude-sonnet-4-20250514"). */
    model?: string | null;
    /** Total tokens used. */
    tokensUsed?: number | null;
    /** Input/prompt tokens. */
    inputTokens?: number | null;
    /** Output/completion tokens. */
    outputTokens?: number | null;
    /** Estimated cost in USD. */
    estimatedCost?: number | null;
    /** Latency in milliseconds. */
    latencyMs?: number | null;
    /** Associated lead ID (if applicable). */
    leadId?: string | null;
    /** Whether the AI call succeeded. Defaults to true. */
    success?: boolean;
    /** Error type if the call failed. */
    errorType?: string | null;
}
/** Response from POST /api/admin/ai/usage-log */
interface LogAiUsageResponse {
    logged: boolean;
    costCapExceeded: boolean;
    dailyCost: number;
    monthlyCost: number;
}

declare class AdminResource {
    private readonly transport;
    constructor(transport: Transport);
    /**
     * Log AI usage for cost tracking and cap enforcement.
     *
     * POST /api/admin/ai/usage-log (non-v1 route)
     *
     * Called by spoke apps (Home Stretch, Milo Engine, etc.) to record AI
     * inference calls. Rello aggregates costs and enforces daily/monthly caps.
     * Returns current cost totals and whether the cap has been exceeded.
     */
    logAiUsage(tenantId: string, data: LogAiUsageInput): Promise<LogAiUsageResponse>;
}

interface RelloClientConfig {
    /** Rello API base URL. Default: RELLO_API_URL env var. Must NOT include "/api". */
    baseUrl?: string;
    /** API key for authentication. Default: RELLO_API_KEY env var. */
    apiKey?: string;
    /**
     * Refuse to fall back to the RELLO_API_KEY env var — require `apiKey` to be
     * passed explicitly, and THROW at construction if it is not.
     *
     * Opt-in in v2.26.0 and the default in v3.0.0.
     *
     * WHY THIS EXISTS. The env fallback does not make a missing key silent — the
     * constructor already throws when nothing resolves. What it makes silent is a
     * WRONG key: a caller that means to use its own pair credential
     * (`<SPOKE>_TO_RELLO_API_KEY`) but forgets to pass it silently gets
     * RELLO_API_KEY instead. Both clients construct identically, and the mistake
     * surfaces later as a 401 on a different line in a different file. Three
     * spokes carry comments asking future authors to remember to pass one
     * explicitly, which is the shape this replaces: a rule that must be
     * remembered eventually is not.
     *
     * A startup failure is a fixable Tuesday. A silent deferral is a hundred days.
     */
    requireExplicitApiKey?: boolean;
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
    readonly auth: AuthResource;
    readonly admin: AdminResource;
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
 * Canonical Rello API base URL normalizer.
 *
 * Strips leading/trailing whitespace, trailing /api or /api/, and trailing
 * slashes from RELLO_API_URL so every caller can construct full paths from
 * the domain root:
 *   `${getRelloBaseUrl()}/api/v1/agent-profile`
 *   `${getRelloBaseUrl()}/api/signals/batch`
 *
 * Guards against env-var misconfiguration where RELLO_API_URL includes
 * /api (e.g. https://hellorello.app/api), which would otherwise produce
 * double-prefix URLs like /api/api/v1/... → 404.
 *
 * v2.7.0 — symmetric defensive .trim() applied to the (env || fallback) read
 * before regex stripping, absorbing the e63a77d cross-spoke lockstep retrofit
 * permanently into the canonical. The retrofit was triggered by MarketIntel's
 * prod Railway MILO_API_URL carrying 1 trailing whitespace character ("https://
 * milo-engine-production.up.railway.app "), producing `Failed to parse URL
 * from .../app /api/...` at runtime. Operator paste-time mistakes can hit
 * either env value or fallback; trimming both closes the class.
 *
 * v2.6.0 — consolidated into @rello-platform/api-client; previously
 * duplicated byte-identically across 9 spokes' src/lib/rello-url.ts.
 *
 * @see PTA-022 (original normalizer); PA-041 (consolidation);
 *      PA-041 Phase B Class B THS halt-and-surface (defensive trim)
 */
declare function getRelloBaseUrl(fallback?: string): string;

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
declare function getMiloBaseUrl(fallback?: string): string;

/**
 * Canonical Harvest Home Intake base URL normalizer.
 *
 * Strips leading/trailing whitespace, trailing /api or /api/, and trailing
 * slashes from HH_INTAKE_URL so every caller can construct full paths from
 * the domain root:
 *   `${getHarvestHomeBaseUrl()}/api/intake`
 *   `${getHarvestHomeBaseUrl()}/api/intake/re-enrich`
 *
 * Guards against env-var misconfiguration where HH_INTAKE_URL includes
 * /api (e.g. https://harvesthome.app/api), which would otherwise produce
 * double-prefix URLs like /api/api/intake → 404. Mirrors the
 * getRelloBaseUrl() / getMiloBaseUrl() shape exactly per universal floor
 * § RELLO_API_URL convention.
 *
 * v2.14.0 — Wave C4b /api-retirement: HH_INTAKE_URL canonical shape moves
 * to domain-root (https://harvesthome.app); consumer code constructs the
 * full path (/api/intake, /api/intake/re-enrich, /api/intake/re-enrich-batch)
 * via this normalizer. Legacy /api-suffixed values (https://harvesthome.app/api)
 * are tolerated by the strip-regex during the migration window. Replaces
 * hand-rolled strip-/api regex previously inlined at
 * ~/Rello/src/lib/integrations/hh-intake.ts.
 *
 * @see PA-041 (the audit that consolidated the prior RELLO/MILO normalizers);
 *      DISCOVERED/hh-intake-url-api-retirement-pattern-required-2026-05-11
 */
declare function getHarvestHomeBaseUrl(fallback?: string): string;

/**
 * Canonical Pathfinder Pro base URL normalizer.
 *
 * Strips leading/trailing whitespace, trailing /api or /api/, and trailing
 * slashes from PATHFINDER_PRO_API_URL so every caller can construct full
 * paths from the domain root:
 *   `${getPathfinderProBaseUrl()}/api/intakes/from-spoke`
 *   `${getPathfinderProBaseUrl()}/api/provisioning/agent`
 *
 * Guards against env-var misconfiguration where PATHFINDER_PRO_API_URL
 * includes /api (e.g. https://pathfinder-pro.app/api), which would
 * otherwise produce double-prefix URLs like /api/api/intakes/... → 404.
 *
 * Mirrors getRelloBaseUrl() / getMiloBaseUrl() / getHarvestHomeBaseUrl()
 * shape exactly per universal floor § RELLO_API_URL convention. Symmetric
 * defensive .trim() applied to the (env || fallback) read before regex
 * stripping, matching the v2.7.0 cross-helper retrofit (operator paste-time
 * mistakes can hit either env value or fallback; trimming both closes the
 * class).
 *
 * v2.16.0 — introduced for the Home Scout `get-pre-approved` CTA → PFP
 * cross-app build (Q-NEW-5 lock 2026-05-12). HS outbound caller in
 * src/lib/pathfinder-pro-client.ts (MAIN-BUILD wave) uses this helper to
 * construct the receiver URL. Sibling to the new
 * @rello-platform/pfp-intake-from-spoke payload schema package and the
 * @rello-platform/permissions::INTAKE_FROM_SPOKE_WRITE slug (v0.30.0).
 *
 * @see PA-041 (the audit that consolidated the prior RELLO/MILO normalizers);
 *      HS ANSWERS.md §16 Q-NEW-5 (cross-app integration architecture lock);
 *      ~SLUG-AUTH-DRIFT-PREVENTION-README.md §4 (URL convention)
 */
declare function getPathfinderProBaseUrl(fallback?: string): string;

/**
 * Canonical The-Oven base URL normalizer.
 *
 * Strips leading/trailing whitespace, trailing /api or /api/, and trailing
 * slashes from THE_OVEN_API_URL so every caller can construct full paths
 * from the domain root:
 *   `${getOvenBaseUrl()}/api/homeowner-profile/${leadId}?tenantId=${tenantId}`
 *
 * Guards against env-var misconfiguration where THE_OVEN_API_URL includes
 * /api (e.g. https://the-oven.hellorello.app/api), which would otherwise
 * produce double-prefix URLs like /api/api/homeowner-profile/... → 404.
 *
 * Mirrors getRelloBaseUrl() / getMiloBaseUrl() / getHarvestHomeBaseUrl() /
 * getPathfinderProBaseUrl() shape exactly per universal floor § RELLO_API_URL
 * convention. Symmetric defensive .trim() applied to the (env || fallback)
 * read before regex stripping, matching the v2.7.0 cross-helper retrofit
 * (operator paste-time mistakes can hit either env value or fallback;
 * trimming both closes the class).
 *
 * Env-var name: THE_OVEN_API_URL — canonical SCREAMING_SNAKE form derived
 * from the `the-oven` app slug per `@rello-platform/slugs` APP_SLUGS. New
 * spokes adopting this helper should mint THE_OVEN_API_URL on their
 * Railway env (legacy callsites using the shorter OVEN_API_URL — e.g.
 * Harvest-Home's `src/lib/oven-client.ts` — predate the canonical naming
 * convention and live outside this helper's scope; see
 * feedback-homestretch-outbound-to-rello-uses-legacy-rello-api-key-naming
 * for the wider legacy-vs-canonical pattern).
 *
 * v2.19.0 — introduced for the Rello MLO RATE CHANGE MONITOR build
 * (ANSWERS.md Q9 lock 2026-05-14, Phase D0). Phase D consumes this helper
 * in `~/Rello/src/lib/rate-data/anchors.ts` to construct the Bearer-S2S
 * read URL for Oven's HomeownerProfile.originalRate (lowest-priority
 * anchor source in the SPEC §2.7 priority chain: `hh_lien1_rate` >
 * `scout_rate_alert_target_rate` > `HomeownerProfile.originalRate` >
 * none). Phase G consumes this helper in
 * `~/Rello/src/trigger/jobs/refi-target-sweep.ts` to walk the same anchor
 * source from the refi-target sweep cron. Both callers authenticate with
 * the `oven:homeowner-profile-read` permission slug
 * (`PERMISSIONS.OVEN_HOMEOWNER_PROFILE_READ` from
 * `@rello-platform/permissions`), against a (RELLO, THE_OVEN) ApiKey row
 * minted via Platform Admin → Apps → Settings. Sibling to the new
 * Rello-side reader; receiver endpoint `GET /api/homeowner-profile/[leadId]`
 * exists at The-Oven origin/main per RECON R9 §B (returns `null` JSON 200
 * for missing rows per the em-dash Rule L convention).
 *
 * @see BUILD-|-WORKSTREAM/MLO RATE CHANGE MONITOR/ Phase D0;
 *      BUILD-|-WORKSTREAM/MLO RATE CHANGE MONITOR/ANSWERS.md Q9 (lock);
 *      BUILD-|-WORKSTREAM/MLO RATE CHANGE MONITOR/RECON-R9-OVEN-HOMEOWNER-PROFILE-FINDINGS-2026-05-14.md § "CRITICAL FINDING" (helper-absence baseline) + §B (Oven endpoint shape);
 *      ~SLUG-AUTH-DRIFT-PREVENTION-README.md §4 (URL convention)
 */
declare function getOvenBaseUrl(fallback?: string): string;

/**
 * Canonical Property Engine base URL normalizer.
 *
 * Strips leading/trailing whitespace, trailing /api or /api/, and trailing
 * slashes from PROPERTY_ENGINE_API_URL so every caller can construct full
 * paths from the domain root:
 *   `${getPropertyEngineBaseUrl()}/api/rates/current`
 *   `${getPropertyEngineBaseUrl()}/api/properties/lookup`
 *
 * Guards against env-var misconfiguration where PROPERTY_ENGINE_API_URL
 * includes /api (e.g. https://property-engine.app/api), which would
 * otherwise produce double-prefix URLs like /api/api/rates/current → 404.
 *
 * Mirrors getRelloBaseUrl() / getMiloBaseUrl() / getHarvestHomeBaseUrl() /
 * getPathfinderProBaseUrl() shape exactly per universal floor § RELLO_API_URL
 * convention. Symmetric defensive .trim() applied to the (env || fallback)
 * read before regex stripping, matching the v2.7.0 cross-helper retrofit
 * (operator paste-time mistakes can hit either env value or fallback;
 * trimming both closes the class).
 *
 * v2.17.0 — Introduced for the D5 Platform PE Client Canonicalization
 * dispatch (5-spoke local-copy retirement; The-Oven carved to D10 follow-up).
 * Closes DISCOVERED-PFP-PE-CLIENT-LOCAL-NOT-API-CLIENT-PACKAGE-2026-05-12.
 * Spokes Scout/MarketIntel/Drumbeat/PFP migrate from local
 * src/lib/property-engine/auth.ts copies to this canonical helper same-PR
 * per Rule J pre-delete verification.
 *
 * Note: prior local copies read process.env.PROPERTY_ENGINE_URL (no _API_
 * segment). The canonical helper reads PROPERTY_ENGINE_API_URL to align with
 * the platform-wide <SERVICE>_API_URL convention. The four migrating spokes
 * rename Railway env from PROPERTY_ENGINE_URL → PROPERTY_ENGINE_API_URL
 * same-coord per the D5 dispatch's Railway env-mirror block.
 *
 * @see DISCOVERED-PFP-PE-CLIENT-LOCAL-NOT-API-CLIENT-PACKAGE-2026-05-12;
 *      ~RATE-DATA-ARCHITECTURE-README.md (Pattern A consumer surfaces);
 *      feedback-cross-app-target-urls-via-api-client-base-url-helpers
 */
declare function getPropertyEngineBaseUrl(fallback?: string): string;

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
declare function getPropertyEngineHeaders(apiKey: string): Record<string, string>;

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
declare function hasPropertyEngineCredentials(apiKey: string | undefined): boolean;

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
    /**
     * Maximum staleness window beyond TTL expiry during which the validator
     * will serve last-good cache when the upstream Rello service-keys endpoint
     * returns 5xx, a 4xx other than 401/403, network error, or timeout. Past
     * this window the validator fails closed (returns null on every inbound).
     * 401 and 403 always fail closed (no stale-serve): they are the only
     * answers about OUR credential, and serving past them would mask credential
     * drift. Any other 4xx (409, 404, 429, …) is an unknown from something
     * between us and Rello — measured 2026-09-29: an edge 409 that never reached
     * Rello's app — and is treated like a 5xx (since 2.28.1).
     *
     * Default: 1800000 (30 minutes). Total worst-case stale window =
     * cacheTtlMs + staleServeMaxMs (35 min default).
     *
     * Set to 0 to disable stale-serve (fail-closed on the first 5xx after
     * cache populate — equivalent to v2.10.0 and earlier behavior).
     */
    staleServeMaxMs?: number;
}
/**
 * Result of a successful caller validation.
 */
interface PlatformCaller {
    /** The appSource from the ApiKey record (e.g., "THE_DRUMBEAT"). */
    appSource: string;
    /** The ApiKey record ID. */
    keyId: string;
    /** Permissions array from the ApiKey record. Canonical slugs from `@rello-platform/permissions`. */
    permissions: readonly (PermissionSlug | "*")[];
}
/**
 * Why a validator call returned null (since 2.28.1).
 *
 * - `no-bearer`          — the request carried no `Authorization: Bearer <token>`.
 * - `no-key-match`       — the cache is usable and no cached key hash matches the token.
 * - `auth-refused`       — the last refresh got 401/403: every token is refused until a refresh succeeds.
 * - `no-cache`           — no refresh has ever succeeded, so there is nothing to match against.
 * - `stale-cap-exceeded` — upstream has been failing past `cacheTtlMs + staleServeMaxMs`.
 *
 * Only `no-key-match` and `no-bearer` are about the inbound token. The other
 * three mean the validator refused every token, whatever it was.
 */
type ValidatorNullReason = "no-bearer" | "no-key-match" | "auth-refused" | "no-cache" | "stale-cap-exceeded";
interface ValidatorNullReport {
    reason: ValidatorNullReason;
    /** HTTP status of the last failed key refresh, when the reason is a refusal and one is known; else null. */
    httpStatus: number | null;
}
/**
 * The validator returned by `createPlatformKeyValidator`: call it with the
 * inbound Request, exactly as before. `reasonFor(request)` then reports why
 * that same Request got null (undefined if it got a caller or was never
 * validated). Read-only: it never changes what the call returns. Keyed by the
 * Request object, so concurrent requests never see each other's reason.
 */
type PlatformKeyValidator = ((request: Request) => Promise<PlatformCaller | null>) & {
    reasonFor(request: Request): ValidatorNullReport | undefined;
};
declare function createPlatformKeyValidator(config: PlatformKeyValidatorConfig): PlatformKeyValidator;
/**
 * Returns true if the caller has the platform-wide wildcard permission
 * OR the specific required permission. Centralizes the wildcard-OR-specific
 * pattern that 9 consumer repos previously duplicated locally.
 */
declare function callerHasPermission(caller: PlatformCaller, required: PermissionSlug): boolean;
/**
 * Configuration for the service Bearer guard factory.
 */
interface ServiceBearerGuardConfig {
    /**
     * Resolves the validator at call time. Returning null fails-closed with
     * `BEARER_UNAVAILABLE` (env misconfig, etc.). Each consumer wires this to
     * their existing lazy-singleton `getValidator()` (typically built from
     * `createPlatformKeyValidator` with the spoke's own `OWN_APP_SLUG` /
     * env-var reads).
     */
    getValidator: () => ((request: Request) => Promise<PlatformCaller | null>) | null;
}
/**
 * Create a fail-closed Bearer-only auth guard for inbound service-to-service
 * routes. Returned function takes the inbound request + the required
 * permission, validates the Bearer hash against Rello's ApiKey table via the
 * configured validator, and returns either:
 *   - `PlatformCaller` on success
 *   - `Response` (401/403) the route handler should return verbatim
 *
 * Standard `Response` (not `NextResponse`) is returned so this helper stays
 * framework-agnostic — Next.js route handlers accept standard Response
 * returns, and `instanceof Response` matches both Response and NextResponse.
 *
 * Replaces per-spoke duplication of the same shape (NS Phase 5b
 * `requireServiceBearer`, etc.). Closes the SHAPE-01-class env-var Bearer
 * bypass on every spoke's inbound service surface — see Platform CLAUDE.md
 * §Inter-App Auth: "NEVER add a `process.env.FOO_SECRET` Bearer-compare
 * fallback alongside the ApiKey path."
 *
 * @example
 *   // Spoke-side wiring (mirrors NS's pre-canonical local impl):
 *   import { createServiceBearerGuard, createPlatformKeyValidator, getRelloBaseUrl } from "@rello-platform/api-client";
 *
 *   let _validator = null;
 *   function getValidator() {
 *     if (_validator) return _validator;
 *     const url = getRelloBaseUrl();
 *     const key = process.env.RELLO_API_KEY;
 *     if (!url || !key) return null;
 *     _validator = createPlatformKeyValidator({ relloApiUrl: url, relloApiKey: key, ownAppSlug: "harvest-home" });
 *     return _validator;
 *   }
 *
 *   export const requireServiceBearer = createServiceBearerGuard({ getValidator });
 *
 *   // Route handler:
 *   const auth = await requireServiceBearer(request, { permission: PERMISSIONS.PROVISIONING_WRITE.slug });
 *   if (auth instanceof Response) return auth;
 *   // auth is PlatformCaller — use auth.appSource / auth.keyId for logging.
 */
declare function createServiceBearerGuard(config: ServiceBearerGuardConfig): (request: Request, opts: {
    permission: PermissionSlug;
}) => Promise<PlatformCaller | Response>;

interface RelloPermissionSelfCheckConfig {
    /** Rello API base URL (domain root; must NOT include "/api"). Normalized like createPlatformKeyValidator. */
    relloApiUrl: string;
    /** The wired `<SPOKE>_TO_RELLO_API_KEY` value to validate (the same value the production client resolves). */
    relloApiKey: string;
    /** This spoke's expected appSource — UPPER_SNAKE or kebab; normalized before the pair assertion. */
    ownAppSource: string;
    /** The spoke's `REQUIRED_RELLO_PERMISSIONS` — slugs from `@rello-platform/permissions`, never hand-typed. */
    requiredPermissions: readonly PermissionSlug[];
    /** Fetch timeout in ms. Default 10_000 (mirrors createPlatformKeyValidator). */
    timeoutMs?: number;
}
type SelfCheckResult = {
    ok: true;
    keyId: string;
    appSource: string;
    permissions: PermissionSlug[];
} | {
    ok: false;
    class: "missing-permissions";
    keyId: string;
    missing: PermissionSlug[];
} | {
    ok: false;
    class: "wrong-pair";
    expected: string;
    actual: string;
} | {
    ok: false;
    class: "invalid-key";
} | {
    ok: false;
    class: "rello-unreachable";
    status: number | "network" | "timeout";
};
/**
 * Run the self-check once and classify the result. Never throws — every failure
 * mode maps to a `SelfCheckResult` so the caller (a deploy-time runner) decides
 * exit posture. `rello-unreachable` is the fail-safe bucket (exit 0, never block).
 */
declare function runRelloPermissionSelfCheck(config: RelloPermissionSelfCheckConfig): Promise<SelfCheckResult>;
/**
 * Factory mirroring `createPlatformKeyValidator`'s shape: binds config once and
 * returns a zero-arg runner. Spokes whose runner script captures config at module
 * scope can use either this or `runRelloPermissionSelfCheck` directly.
 */
declare function createRelloPermissionSelfCheck(config: RelloPermissionSelfCheckConfig): () => Promise<SelfCheckResult>;

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
    phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
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
    agentProfile: z.ZodOptional<z.ZodLazy<z.ZodObject<{
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
    }, z.core.$strip>>>;
    wizardAnswers: z.ZodOptional<z.ZodArray<z.ZodLazy<z.ZodObject<{
        questionId: z.ZodString;
        question: z.ZodString;
        answer: z.ZodUnknown;
    }, z.core.$strip>>>>;
    hasLinkedUser: z.ZodOptional<z.ZodBoolean>;
    isTenantOwner: z.ZodOptional<z.ZodBoolean>;
    loginless: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
type ProvisionedAgent = z.infer<typeof provisionedAgentSchema>;
declare const tenantEnablePayloadSchema: z.ZodObject<{
    action: z.ZodLiteral<"enable">;
    relloTenantId: z.ZodString;
    tenant: z.ZodObject<{
        name: z.ZodString;
        slug: z.ZodString;
        logoUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        primaryColor: z.ZodNullable<z.ZodString>;
        physicalAddress: z.ZodNullable<z.ZodString>;
        applicationUrl: z.ZodNullable<z.ZodString>;
        type: z.ZodString;
        plan: z.ZodString;
        billingOrigin: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
    agents: z.ZodArray<z.ZodObject<{
        relloAgentId: z.ZodString;
        email: z.ZodString;
        firstName: z.ZodString;
        lastName: z.ZodString;
        slug: z.ZodString;
        role: z.ZodString;
        phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
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
        agentProfile: z.ZodOptional<z.ZodLazy<z.ZodObject<{
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
        }, z.core.$strip>>>;
        wizardAnswers: z.ZodOptional<z.ZodArray<z.ZodLazy<z.ZodObject<{
            questionId: z.ZodString;
            question: z.ZodString;
            answer: z.ZodUnknown;
        }, z.core.$strip>>>>;
        hasLinkedUser: z.ZodOptional<z.ZodBoolean>;
        isTenantOwner: z.ZodOptional<z.ZodBoolean>;
        loginless: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    planGrants: z.ZodOptional<z.ZodNullable<z.ZodLazy<z.ZodObject<{
        rev: z.ZodNumber;
        grants: z.ZodArray<z.ZodString>;
        planSlug: z.ZodNullable<z.ZodString>;
        cause: z.ZodOptional<z.ZodString>;
        trial: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            planSlug: z.ZodString;
            startedAt: z.ZodString;
            endsAt: z.ZodString;
        }, z.core.$strip>>>;
    }, z.core.$strip>>>>;
    cyr: z.ZodOptional<z.ZodNullable<z.ZodLazy<z.ZodObject<{
        featureSlug: z.ZodString;
        status: z.ZodEnum<{
            ACTIVE: "ACTIVE";
            TRIALING: "TRIALING";
            PAST_DUE: "PAST_DUE";
            CANCELED: "CANCELED";
        }>;
        quantity: z.ZodNumber;
        trialEndsAt: z.ZodNullable<z.ZodString>;
        canceledAt: z.ZodNullable<z.ZodString>;
        occurredAt: z.ZodString;
        seq: z.ZodNumber;
        source: z.ZodEnum<{
            plan: "plan";
            addon: "addon";
            both: "both";
        }>;
        cause: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>>;
    addOns: z.ZodOptional<z.ZodArray<z.ZodLazy<z.ZodObject<{
        featureSlug: z.ZodString;
        status: z.ZodEnum<{
            ACTIVE: "ACTIVE";
            TRIALING: "TRIALING";
            PAST_DUE: "PAST_DUE";
            CANCELED: "CANCELED";
        }>;
        quantity: z.ZodNumber;
        trialEndsAt: z.ZodNullable<z.ZodString>;
        canceledAt: z.ZodNullable<z.ZodString>;
        occurredAt: z.ZodString;
        seq: z.ZodNumber;
        source: z.ZodEnum<{
            plan: "plan";
            addon: "addon";
            both: "both";
        }>;
        cause: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>>;
    creditAllocation: z.ZodOptional<z.ZodObject<{
        initialBalance: z.ZodOptional<z.ZodNumber>;
        poolSize: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
type TenantEnablePayload = z.infer<typeof tenantEnablePayloadSchema>;
/**
 * PFP Gateway §4.2 — a tenant's plan grants. `grants` holds feature slugs
 * (`FEATURE_SLUGS` in @rello-platform/slugs); kept as plain strings here so a
 * receiver on an older slugs release still parses a newer feature.
 */
declare const tenantPlanGrantsSchema: z.ZodObject<{
    rev: z.ZodNumber;
    grants: z.ZodArray<z.ZodString>;
    planSlug: z.ZodNullable<z.ZodString>;
    cause: z.ZodOptional<z.ZodString>;
    trial: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        planSlug: z.ZodString;
        startedAt: z.ZodString;
        endsAt: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
type TenantPlanGrants = z.infer<typeof tenantPlanGrantsSchema>;
/**
 * PFP Gateway §4.3 rule 3 — the effective Check Your Rate record: the eight
 * named fields of `billing.addon_changed`. Non-strict on purpose (GD-1582): the
 * event's other keys (previousStatus, addOnId, tenantAddOnId) are accepted and
 * dropped. `cause` is kept (KA amendment 1109): plan_change = this record
 * changed because of a plan switch; absent = any other change.
 */
declare const tenantCyrStateSchema: z.ZodObject<{
    featureSlug: z.ZodString;
    status: z.ZodEnum<{
        ACTIVE: "ACTIVE";
        TRIALING: "TRIALING";
        PAST_DUE: "PAST_DUE";
        CANCELED: "CANCELED";
    }>;
    quantity: z.ZodNumber;
    trialEndsAt: z.ZodNullable<z.ZodString>;
    canceledAt: z.ZodNullable<z.ZodString>;
    occurredAt: z.ZodString;
    seq: z.ZodNumber;
    source: z.ZodEnum<{
        plan: "plan";
        addon: "addon";
        both: "both";
    }>;
    cause: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type TenantCyrState = z.infer<typeof tenantCyrStateSchema>;
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
        logoUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        primaryColor: z.ZodNullable<z.ZodString>;
        physicalAddress: z.ZodNullable<z.ZodString>;
        applicationUrl: z.ZodNullable<z.ZodString>;
        type: z.ZodString;
        plan: z.ZodString;
        billingOrigin: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
    agents: z.ZodArray<z.ZodObject<{
        relloAgentId: z.ZodString;
        email: z.ZodString;
        firstName: z.ZodString;
        lastName: z.ZodString;
        slug: z.ZodString;
        role: z.ZodString;
        phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
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
        agentProfile: z.ZodOptional<z.ZodLazy<z.ZodObject<{
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
        }, z.core.$strip>>>;
        wizardAnswers: z.ZodOptional<z.ZodArray<z.ZodLazy<z.ZodObject<{
            questionId: z.ZodString;
            question: z.ZodString;
            answer: z.ZodUnknown;
        }, z.core.$strip>>>>;
        hasLinkedUser: z.ZodOptional<z.ZodBoolean>;
        isTenantOwner: z.ZodOptional<z.ZodBoolean>;
        loginless: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    planGrants: z.ZodOptional<z.ZodNullable<z.ZodLazy<z.ZodObject<{
        rev: z.ZodNumber;
        grants: z.ZodArray<z.ZodString>;
        planSlug: z.ZodNullable<z.ZodString>;
        cause: z.ZodOptional<z.ZodString>;
        trial: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            planSlug: z.ZodString;
            startedAt: z.ZodString;
            endsAt: z.ZodString;
        }, z.core.$strip>>>;
    }, z.core.$strip>>>>;
    cyr: z.ZodOptional<z.ZodNullable<z.ZodLazy<z.ZodObject<{
        featureSlug: z.ZodString;
        status: z.ZodEnum<{
            ACTIVE: "ACTIVE";
            TRIALING: "TRIALING";
            PAST_DUE: "PAST_DUE";
            CANCELED: "CANCELED";
        }>;
        quantity: z.ZodNumber;
        trialEndsAt: z.ZodNullable<z.ZodString>;
        canceledAt: z.ZodNullable<z.ZodString>;
        occurredAt: z.ZodString;
        seq: z.ZodNumber;
        source: z.ZodEnum<{
            plan: "plan";
            addon: "addon";
            both: "both";
        }>;
        cause: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>>;
    addOns: z.ZodOptional<z.ZodArray<z.ZodLazy<z.ZodObject<{
        featureSlug: z.ZodString;
        status: z.ZodEnum<{
            ACTIVE: "ACTIVE";
            TRIALING: "TRIALING";
            PAST_DUE: "PAST_DUE";
            CANCELED: "CANCELED";
        }>;
        quantity: z.ZodNumber;
        trialEndsAt: z.ZodNullable<z.ZodString>;
        canceledAt: z.ZodNullable<z.ZodString>;
        occurredAt: z.ZodString;
        seq: z.ZodNumber;
        source: z.ZodEnum<{
            plan: "plan";
            addon: "addon";
            both: "both";
        }>;
        cause: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>>;
    creditAllocation: z.ZodOptional<z.ZodObject<{
        initialBalance: z.ZodOptional<z.ZodNumber>;
        poolSize: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
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
        phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
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
        agentProfile: z.ZodOptional<z.ZodLazy<z.ZodObject<{
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
        }, z.core.$strip>>>;
        wizardAnswers: z.ZodOptional<z.ZodArray<z.ZodLazy<z.ZodObject<{
            questionId: z.ZodString;
            question: z.ZodString;
            answer: z.ZodUnknown;
        }, z.core.$strip>>>>;
        hasLinkedUser: z.ZodOptional<z.ZodBoolean>;
        isTenantOwner: z.ZodOptional<z.ZodBoolean>;
        loginless: z.ZodOptional<z.ZodBoolean>;
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
    physicalAddress: z.ZodOptional<z.ZodNullable<z.ZodUnknown>>;
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
 * PFP Gateway X2: PathfinderPro → Rello roster routes (spec SPEC-PFP-GATEWAY.md
 * rev 10.30 §6 "[D30] Extra-signature MLOs", G-EXTRAS, D33; Platform KA prompts
 * 1152/1155, plan a4-1151 ruled). One contract for Rello's routes and PFP's callers.
 *
 * Auth on every route: `Authorization: Bearer <ApiKey>` (Rello's ApiKey table,
 * targetApp RELLO), the route's narrow permission (`agents:loginless:write` /
 * `team:members:write`), the key's appSource enabled for the tenant, a
 * tenant-bound key naming only its own tenant, and `actingRelloUserId` an active
 * owner of that tenant. The tenant is never taken from a header.
 *
 *   POST /api/provisioning/loginless-agent                       (X2a)
 *   POST /api/provisioning/loginless-agent/[agentId]/remove      (X2a)
 *   POST /api/provisioning/team-member                           (X2b)
 *   GET  /api/provisioning/team-member?tenantId=&actingRelloUserId= (X2b, v2.35.0)
 *   POST /api/provisioning/team-member/[userId]/sign-in-link     (X2b)
 *   POST /api/provisioning/team-member/[userId]/remove           (X2b)
 */

/** Only name and email: NMLS, licensed states, phone and photo are Home Scout's (§4.9). */
declare const loginlessAgentCreateRequestSchema: z.ZodObject<{
    tenantId: z.ZodString;
    actingRelloUserId: z.ZodString;
    firstName: z.ZodString;
    lastName: z.ZodString;
    email: z.ZodPipe<z.ZodString, z.ZodEmail>;
    requestId: z.ZodString;
}, z.core.$strict>;
type LoginlessAgentCreateRequest = z.infer<typeof loginlessAgentCreateRequestSchema>;
/** 201 on create; 200 with `replayed: true` for the same requestId and body. */
interface LoginlessAgentCreateResponse {
    relloAgentId: string;
    slug: string;
    email: string;
    replayed: boolean;
}
declare const loginlessAgentRemoveRequestSchema: z.ZodObject<{
    tenantId: z.ZodString;
    actingRelloUserId: z.ZodString;
}, z.core.$strict>;
type LoginlessAgentRemoveRequest = z.infer<typeof loginlessAgentRemoveRequestSchema>;
/** 200. Remove sets the agent INACTIVE; nothing is deleted. */
interface LoginlessAgentRemoveResponse {
    relloAgentId: string;
    status: "INACTIVE";
    alreadyInactive: boolean;
}
declare const teamMemberCreateRequestSchema: z.ZodObject<{
    tenantId: z.ZodString;
    actingRelloUserId: z.ZodString;
    email: z.ZodPipe<z.ZodString, z.ZodEmail>;
    firstName: z.ZodString;
    lastName: z.ZodString;
    requestId: z.ZodString;
}, z.core.$strict>;
type TeamMemberCreateRequest = z.infer<typeof teamMemberCreateRequestSchema>;
interface TeamMemberCreateResponse {
    userId: string;
    relloAgentId: string;
    email: string;
    signInEmail: "queued";
    replayed: boolean;
}
/**
 * v2.35.0: `requestId` is required. A resend is one owner action and one email: the
 * caller mints a requestId per click and keeps it until it gets an answer, so a
 * retry after a lost answer replays (200, `replayed: true`) and never sends a
 * second email. (v2.33.0 had no requestId; nothing called the route yet.)
 */
declare const teamMemberSignInLinkRequestSchema: z.ZodObject<{
    tenantId: z.ZodString;
    actingRelloUserId: z.ZodString;
    requestId: z.ZodString;
}, z.core.$strict>;
type TeamMemberSignInLinkRequest = z.infer<typeof teamMemberSignInLinkRequestSchema>;
/** 202 when queued; 200 with `replayed: true` for the same requestId. */
interface TeamMemberSignInLinkResponse {
    userId: string;
    signInEmail: "queued";
    replayed: boolean;
}
declare const teamMemberRemoveRequestSchema: z.ZodObject<{
    tenantId: z.ZodString;
    actingRelloUserId: z.ZodString;
}, z.core.$strict>;
type TeamMemberRemoveRequest = z.infer<typeof teamMemberRemoveRequestSchema>;
interface TeamMemberRemoveResponse {
    userId: string;
    isActive: false;
    alreadyInactive: boolean;
}
/** The query string of `GET /api/provisioning/team-member`. */
declare const teamLoginRosterQuerySchema: z.ZodObject<{
    tenantId: z.ZodString;
    actingRelloUserId: z.ZodString;
}, z.core.$strict>;
type TeamLoginRosterQuery = z.infer<typeof teamLoginRosterQuerySchema>;
/** One person with an active login in the account. */
interface TeamLoginRosterMember {
    userId: string;
    /** The person's Rello Agent, or null when the login has none. */
    relloAgentId: string | null;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    /** An owner role (MLO_OWNER, BROKER_OWNER, AGENT_OWNER): cannot be removed here. */
    isOwner: boolean;
}
/**
 * 200. Derived at read time; nothing is stored.
 * - `included`: the plan's logins (`Plan.maxUsers`); null = the plan sets no limit.
 * - `purchased`: the live `pfp-extra-team-login` quantity (0 with none).
 * - `capacity`: included + purchased; null when included is null.
 * - `members`: active logins now.
 * - `overBy`: members − capacity when positive, else 0. An out-of-band quantity drop
 *   (a Stripe-side or admin edit) can leave an account over; everyone keeps working,
 *   nobody is removed, and the owner adds a login or removes someone.
 */
interface TeamLoginRosterResponse {
    included: number | null;
    purchased: number;
    capacity: number | null;
    members: number;
    overBy: number;
    addOnCatalogKey: "pfp-extra-team-login";
    people: TeamLoginRosterMember[];
}
declare const ROSTER_ERROR_CODES: readonly ["invalid_body", "unauthorized", "key_not_scoped", "missing_permission", "unknown_app", "tenant_mismatch", "app_not_enabled", "actor_not_owner", "agent_not_found", "member_not_found", "cannot_remove_owner", "signature_quantity_needed", "login_quantity_needed", "email_in_use", "already_member", "email_registered_elsewhere", "idempotency_key_reused", "internal_error"];
type RosterErrorCode = (typeof ROSTER_ERROR_CODES)[number];
/** Every non-2xx body. `error` is for a person; `code` is for the caller. */
interface RosterError {
    code: RosterErrorCode;
    error: string;
}
/** 409 signature_quantity_needed: the fix is one more `pfp-extra-signature`. */
interface SignatureQuantityNeeded extends RosterError {
    code: "signature_quantity_needed";
    purchased: number;
    extras: number;
    addOnCatalogKey: "pfp-extra-signature";
}
/** 409 already_member: the email already has a login in this account (`isActive` false = removed earlier). */
interface AlreadyMember extends RosterError {
    code: "already_member";
    userId: string;
    isActive: boolean;
}
/** 409 login_quantity_needed: the fix is one more `pfp-extra-team-login`. */
interface LoginQuantityNeeded extends RosterError {
    code: "login_quantity_needed";
    included: number;
    purchased: number;
    members: number;
    addOnCatalogKey: "pfp-extra-team-login";
}
/** 201 / 200 of POST /api/provisioning/loginless-agent. */
declare const loginlessAgentCreateResponseSchema: z.ZodObject<{
    relloAgentId: z.ZodString;
    slug: z.ZodString;
    email: z.ZodString;
    replayed: z.ZodBoolean;
}, z.core.$strip>;
/** 200 of POST /api/provisioning/loginless-agent/[agentId]/remove. */
declare const loginlessAgentRemoveResponseSchema: z.ZodObject<{
    relloAgentId: z.ZodString;
    status: z.ZodLiteral<"INACTIVE">;
    alreadyInactive: z.ZodBoolean;
}, z.core.$strip>;
/** 201 / 200 of POST /api/provisioning/team-member. */
declare const teamMemberCreateResponseSchema: z.ZodObject<{
    userId: z.ZodString;
    relloAgentId: z.ZodString;
    email: z.ZodString;
    signInEmail: z.ZodLiteral<"queued">;
    replayed: z.ZodBoolean;
}, z.core.$strip>;
/** 202 / 200 of POST /api/provisioning/team-member/[userId]/sign-in-link. */
declare const teamMemberSignInLinkResponseSchema: z.ZodObject<{
    userId: z.ZodString;
    signInEmail: z.ZodLiteral<"queued">;
    replayed: z.ZodBoolean;
}, z.core.$strip>;
/** 200 of POST /api/provisioning/team-member/[userId]/remove. */
declare const teamMemberRemoveResponseSchema: z.ZodObject<{
    userId: z.ZodString;
    isActive: z.ZodLiteral<false>;
    alreadyInactive: z.ZodBoolean;
}, z.core.$strip>;
declare const teamLoginRosterMemberSchema: z.ZodObject<{
    userId: z.ZodString;
    relloAgentId: z.ZodNullable<z.ZodString>;
    email: z.ZodString;
    firstName: z.ZodString;
    lastName: z.ZodString;
    role: z.ZodString;
    isOwner: z.ZodBoolean;
}, z.core.$strip>;
/** 200 of GET /api/provisioning/team-member. `included` and `capacity` are null together (the plan sets no limit). */
declare const teamLoginRosterResponseSchema: z.ZodObject<{
    included: z.ZodNullable<z.ZodNumber>;
    purchased: z.ZodNumber;
    capacity: z.ZodNullable<z.ZodNumber>;
    members: z.ZodNumber;
    overBy: z.ZodNumber;
    addOnCatalogKey: z.ZodLiteral<"pfp-extra-team-login">;
    people: z.ZodArray<z.ZodObject<{
        userId: z.ZodString;
        relloAgentId: z.ZodNullable<z.ZodString>;
        email: z.ZodString;
        firstName: z.ZodString;
        lastName: z.ZodString;
        role: z.ZodString;
        isOwner: z.ZodBoolean;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * Every non-2xx roster body: `{ code, error, ...extra }`. `code` is a plain
 * string on the wire, so a code Rello adds later never makes an older caller
 * refuse the answer; compare it against {@link ROSTER_ERROR_CODES}
 * ({@link isRosterErrorCode}). Extra fields are kept.
 */
declare const rosterErrorSchema: z.ZodObject<{
    code: z.ZodString;
    error: z.ZodString;
}, z.core.$loose>;
type RosterErrorParsed = z.infer<typeof rosterErrorSchema>;
declare function isRosterErrorCode(code: unknown): code is RosterErrorCode;
/** 409 signature_quantity_needed, exactly. */
declare const signatureQuantityNeededSchema: z.ZodObject<{
    code: z.ZodLiteral<"signature_quantity_needed">;
    error: z.ZodString;
    purchased: z.ZodNumber;
    extras: z.ZodNumber;
    addOnCatalogKey: z.ZodLiteral<"pfp-extra-signature">;
}, z.core.$strip>;
/** 409 already_member, exactly. */
declare const alreadyMemberSchema: z.ZodObject<{
    code: z.ZodLiteral<"already_member">;
    error: z.ZodString;
    userId: z.ZodString;
    isActive: z.ZodBoolean;
}, z.core.$strip>;
/** 409 login_quantity_needed, exactly. */
declare const loginQuantityNeededSchema: z.ZodObject<{
    code: z.ZodLiteral<"login_quantity_needed">;
    error: z.ZodString;
    included: z.ZodNumber;
    purchased: z.ZodNumber;
    members: z.ZodNumber;
    addOnCatalogKey: z.ZodLiteral<"pfp-extra-team-login">;
}, z.core.$strip>;

/**
 * PFP Gateway G-SETUP + G-A2P: the one-time setup charge and the texting (A2P
 * 10DLC) registration that PathfinderPro asks Rello for. One contract for Rello's
 * routes and PFP's callers and receivers.
 *
 * Source: plan a6-1143 §D (Platform KA prompts 1143 / 1160 / 1172), spec
 * SPEC-PFP-GATEWAY.md rev 10.31 §4.12d item 6, the Platform KA's 2044Z contract
 * pins (fee GET is contract; attach is decided server-side), H-173 (quoteVersion,
 * 409 fee_changed), GD-1763 (409 business_suspension_final) and GD-1761
 * (an ambiguous provider create has no wire status).
 *
 * ONE envelope per lane. The same envelope is the event `data`, every route
 * answer and the GET, ordered by `rev` (per tenant, agent and lane).
 *
 * Auth on every route: `Authorization: Bearer <ApiKey>` (Rello's ApiKey table,
 * targetApp RELLO, appSource pathfinder-pro), permission
 * `billing:setup-charge:write` (charge lane, incl. the fee GET) or
 * `sms:registration:write` (registration lane), from @rello-platform/permissions
 * v0.61.0+. The tenant is checked against the key; the fee GET takes it from
 * the key alone.
 *
 *   GET  /api/provisioning/setup-charge/fee?feeSlug=…   → oneTimeFeeQuote
 *   POST /api/provisioning/setup-charge                 → setupChargeEnvelope
 *   GET  /api/provisioning/setup-charge?tenantId&relloAgentId&feeSlug
 *   POST /api/provisioning/sms-registration             → smsRegistrationEnvelope
 *   POST /api/provisioning/sms-registration/otp         → smsRegistrationEnvelope
 *   GET  /api/provisioning/sms-registration?tenantId&relloAgentId
 *   events on Rello's billing outbox: billing.setup_charge_changed, sms.registration_changed
 *
 * Rello's admin bodies (fee create/patch, manual settle, suspension outcomes,
 * provider-create outcome) are Rello-internal and are NOT in this package.
 *
 * Module-level helpers carry an `smsSetup` prefix so tsup renames nothing else
 * in the bundle.
 */

/**
 * H-173: the fee row's version. Rello's DB trigger bumps it on any change of the
 * amount, the currency or isActive. PFP echoes the version the MLO confirmed.
 */
declare const quoteVersion: z.ZodNumber;
/**
 * POST /api/provisioning/setup-charge body. Strict: an unknown key is
 * `400 { error: "invalid_field", field, message }`. There is NO amount: Rello
 * charges the fee row's amount, read server-side. `quoteVersion` is required
 * (missing → 400 field "quoteVersion").
 */
declare const setupChargeRequest: z.ZodObject<{
    tenantId: z.ZodString;
    relloAgentId: z.ZodString;
    feeSlug: z.ZodString;
    quoteVersion: z.ZodNumber;
}, z.core.$strict>;
type SetupChargeRequest = z.infer<typeof setupChargeRequest>;
/**
 * `voided`: a MANUAL charge whose hand invoice was never paid (show "No charge
 * was made"). `refunded`: the fee came back (registration could not complete).
 */
declare const setupChargeStatus: z.ZodEnum<{
    failed: "failed";
    unknown: "unknown";
    manual: "manual";
    pending: "pending";
    paid: "paid";
    refunded: "refunded";
    voided: "voided";
}>;
type SetupChargeStatus = z.infer<typeof setupChargeStatus>;
/** The charge envelope: billing.setup_charge_changed `data`, every setup-charge answer body, and the GET. */
declare const setupChargeEnvelope: z.ZodObject<{
    tenantId: z.ZodString;
    relloAgentId: z.ZodString;
    feeSlug: z.ZodString;
    status: z.ZodEnum<{
        failed: "failed";
        unknown: "unknown";
        manual: "manual";
        pending: "pending";
        paid: "paid";
        refunded: "refunded";
        voided: "voided";
    }>;
    /** true only when a PAID row is asked again. */
    alreadyPaid: z.ZodOptional<z.ZodBoolean>;
    /** failed: Stripe's decline message (never card data); manual: the reason in words. */
    message: z.ZodOptional<z.ZodString>;
    chargeId: z.ZodNullable<z.ZodString>;
    rev: z.ZodNumber;
    /** Display only; order by `rev`. */
    occurredAt: z.ZodISODateTime;
}, z.core.$strict>;
type SetupChargeEnvelope = z.infer<typeof setupChargeEnvelope>;
/**
 * POST setup-charge answers:
 *   200 paid | paid + alreadyPaid | manual | refunded     202 pending | unknown     402 failed
 *   400 { error: "invalid_field", field, message }   401 { error }   403 { error }
 *   404 { error: "agent_not_found" } | feeNotFound
 *   409 { error: "registration_required" }  (rate-check fee with no registration for the agent)
 *   409 feeChangedConflict                  (H-173: stale quoteVersion or inactive fee; no charge, no Stripe call)
 *   409 chargeConflict                      (below)
 *   500 internalError
 * An existing charge's own answer (200 alreadyPaid / 202 / 409 refund_in_progress)
 * comes before fee_changed: a retried POST for money already taken is never fee_changed.
 *
 * chargeConflict codes:
 *   registration_rejected     the registration attempt is terminal and not live; re-submit details first
 *   refund_in_progress        the previous attempt's refund is still out
 *   business_suspended        the team's business is suspended at Twilio
 *   business_suspension_final GD-1763: closed by the carriers; no charge until Rello's operator records
 *                             the provider outcome
 * `envelope` is this MLO's charge envelope, or null when the MLO has no charge row.
 */
declare const chargeConflict: z.ZodObject<{
    error: z.ZodEnum<{
        registration_rejected: "registration_rejected";
        refund_in_progress: "refund_in_progress";
        business_suspended: "business_suspended";
        business_suspension_final: "business_suspension_final";
    }>;
    envelope: z.ZodNullable<z.ZodObject<{
        tenantId: z.ZodString;
        relloAgentId: z.ZodString;
        feeSlug: z.ZodString;
        status: z.ZodEnum<{
            failed: "failed";
            unknown: "unknown";
            manual: "manual";
            pending: "pending";
            paid: "paid";
            refunded: "refunded";
            voided: "voided";
        }>;
        /** true only when a PAID row is asked again. */
        alreadyPaid: z.ZodOptional<z.ZodBoolean>;
        /** failed: Stripe's decline message (never card data); manual: the reason in words. */
        message: z.ZodOptional<z.ZodString>;
        chargeId: z.ZodNullable<z.ZodString>;
        rev: z.ZodNumber;
        /** Display only; order by `rev`. */
        occurredAt: z.ZodISODateTime;
    }, z.core.$strict>>;
}, z.core.$strict>;
type ChargeConflict = z.infer<typeof chargeConflict>;
/**
 * GET /api/provisioning/setup-charge/fee?feeSlug=… query. The tenant comes from
 * the ApiKey row, never a parameter. Missing or malformed → 400 field "feeSlug".
 */
declare const feeSlugQuery: z.ZodObject<{
    feeSlug: z.ZodString;
}, z.core.$strict>;
type FeeSlugQuery = z.infer<typeof feeSlugQuery>;
/**
 * 200 of the fee GET, and the `quote` of 409 fee_changed. `isActive: false` =
 * not offered now. The amount is the row's, never a default or a cached price
 * (an unreadable row is 500, never a quote).
 */
declare const oneTimeFeeQuote: z.ZodObject<{
    feeSlug: z.ZodString;
    label: z.ZodString;
    amountCents: z.ZodNumber;
    currency: z.ZodString;
    isActive: z.ZodBoolean;
    quoteVersion: z.ZodNumber;
}, z.core.$strict>;
type OneTimeFeeQuote = z.infer<typeof oneTimeFeeQuote>;
/**
 * H-173: 409 on POST setup-charge when the body's quoteVersion is not the fee
 * row's, or the row is inactive. `quote` is the CURRENT row: PFP shows it for a
 * fresh confirmation and never retries on its own. Replaces `fee_inactive`.
 */
declare const feeChangedConflict: z.ZodObject<{
    error: z.ZodLiteral<"fee_changed">;
    quote: z.ZodObject<{
        feeSlug: z.ZodString;
        label: z.ZodString;
        amountCents: z.ZodNumber;
        currency: z.ZodString;
        isActive: z.ZodBoolean;
        quoteVersion: z.ZodNumber;
    }, z.core.$strict>;
}, z.core.$strict>;
type FeeChangedConflict = z.infer<typeof feeChangedConflict>;
/** 404 of the fee GET and of POST setup-charge: no such fee row. */
declare const feeNotFound: z.ZodObject<{
    error: z.ZodLiteral<"fee_not_found">;
}, z.core.$strict>;
type FeeNotFound = z.infer<typeof feeNotFound>;
/** 500 on every G-SETUP / G-A2P route: never internals. PFP shows "unknown", never "not paid". */
declare const internalError: z.ZodObject<{
    error: z.ZodString;
    requestId: z.ZodString;
}, z.core.$strict>;
type InternalError = z.infer<typeof internalError>;
/** Twilio's business types for a STANDARD brand. */
declare const businessType: z.ZodEnum<{
    "Co-operative": "Co-operative";
    Corporation: "Corporation";
    "Limited Liability Corporation": "Limited Liability Corporation";
    "Non-profit Corporation": "Non-profit Corporation";
    Partnership: "Partnership";
}>;
type BusinessType = z.infer<typeof businessType>;
/** Twilio's business industries. */
declare const businessIndustry: z.ZodEnum<{
    AGRICULTURE: "AGRICULTURE";
    AUTOMOTIVE: "AUTOMOTIVE";
    BANKING: "BANKING";
    CONSTRUCTION: "CONSTRUCTION";
    CONSUMER: "CONSUMER";
    EDUCATION: "EDUCATION";
    ELECTRONICS: "ELECTRONICS";
    ENGINEERING: "ENGINEERING";
    ENERGY: "ENERGY";
    FAST_MOVING_CONSUMER_GOODS: "FAST_MOVING_CONSUMER_GOODS";
    FINANCIAL: "FINANCIAL";
    FINTECH: "FINTECH";
    FOOD_AND_BEVERAGE: "FOOD_AND_BEVERAGE";
    GOVERNMENT: "GOVERNMENT";
    HEALTHCARE: "HEALTHCARE";
    HOSPITALITY: "HOSPITALITY";
    INSURANCE: "INSURANCE";
    JEWELRY: "JEWELRY";
    LEGAL: "LEGAL";
    MANUFACTURING: "MANUFACTURING";
    MEDIA: "MEDIA";
    NOT_FOR_PROFIT: "NOT_FOR_PROFIT";
    OIL_AND_GAS: "OIL_AND_GAS";
    ONLINE: "ONLINE";
    PROFESSIONAL_SERVICES: "PROFESSIONAL_SERVICES";
    RAW_MATERIALS: "RAW_MATERIALS";
    REAL_ESTATE: "REAL_ESTATE";
    RELIGION: "RELIGION";
    RETAIL: "RETAIL";
    TECHNOLOGY: "TECHNOLOGY";
    TELECOMMUNICATIONS: "TELECOMMUNICATIONS";
    TRANSPORTATION: "TRANSPORTATION";
    TRAVEL: "TRAVEL";
}>;
type BusinessIndustry = z.infer<typeof businessIndustry>;
/**
 * POST /api/provisioning/sms-registration body. Strict: an unknown key (e.g.
 * `attachToBusiness`) is `400 invalid_field`.
 *
 * STANDARD: a team shares one business registration. The team's FIRST loan
 * officer sends `business` + `authorizedRep`; a 2nd+ loan officer omits both.
 * Whether the tenant already has a business registration is a DB fact, so the
 * ROUTE decides the branch server-side (never a client flag):
 *   no business row, no business block   → 400 field "business"
 *   business row exists, block sent       → 400 field "business" (never merged or overwritten)
 * Here, the two blocks travel together or not at all.
 *
 * SOLE_PROPRIETOR: `soleProprietor` is required; an LLC business type is refused
 * on `brandType` ("An LLC must register with its EIN.") as the FIRST issue.
 */
declare const smsRegistrationRequest: z.ZodObject<{
    tenantId: z.ZodString;
    relloAgentId: z.ZodString;
    brandType: z.ZodEnum<{
        STANDARD: "STANDARD";
        SOLE_PROPRIETOR: "SOLE_PROPRIETOR";
    }>;
    business: z.ZodOptional<z.ZodObject<{
        /** Exactly as on the IRS CP 575. */
        legalName: z.ZodString;
        businessType: z.ZodEnum<{
            "Co-operative": "Co-operative";
            Corporation: "Corporation";
            "Limited Liability Corporation": "Limited Liability Corporation";
            "Non-profit Corporation": "Non-profit Corporation";
            Partnership: "Partnership";
        }>;
        industry: z.ZodEnum<{
            AGRICULTURE: "AGRICULTURE";
            AUTOMOTIVE: "AUTOMOTIVE";
            BANKING: "BANKING";
            CONSTRUCTION: "CONSTRUCTION";
            CONSUMER: "CONSUMER";
            EDUCATION: "EDUCATION";
            ELECTRONICS: "ELECTRONICS";
            ENGINEERING: "ENGINEERING";
            ENERGY: "ENERGY";
            FAST_MOVING_CONSUMER_GOODS: "FAST_MOVING_CONSUMER_GOODS";
            FINANCIAL: "FINANCIAL";
            FINTECH: "FINTECH";
            FOOD_AND_BEVERAGE: "FOOD_AND_BEVERAGE";
            GOVERNMENT: "GOVERNMENT";
            HEALTHCARE: "HEALTHCARE";
            HOSPITALITY: "HOSPITALITY";
            INSURANCE: "INSURANCE";
            JEWELRY: "JEWELRY";
            LEGAL: "LEGAL";
            MANUFACTURING: "MANUFACTURING";
            MEDIA: "MEDIA";
            NOT_FOR_PROFIT: "NOT_FOR_PROFIT";
            OIL_AND_GAS: "OIL_AND_GAS";
            ONLINE: "ONLINE";
            PROFESSIONAL_SERVICES: "PROFESSIONAL_SERVICES";
            RAW_MATERIALS: "RAW_MATERIALS";
            REAL_ESTATE: "REAL_ESTATE";
            RELIGION: "RELIGION";
            RETAIL: "RETAIL";
            TECHNOLOGY: "TECHNOLOGY";
            TELECOMMUNICATIONS: "TELECOMMUNICATIONS";
            TRANSPORTATION: "TRANSPORTATION";
            TRAVEL: "TRAVEL";
        }>;
        ein: z.ZodString;
        websiteUrl: z.ZodURL;
        companyType: z.ZodEnum<{
            private: "private";
            public: "public";
            "non-profit": "non-profit";
        }>;
        stockExchange: z.ZodOptional<z.ZodString>;
        stockTicker: z.ZodOptional<z.ZodString>;
        brandContactEmail: z.ZodOptional<z.ZodEmail>;
        address: z.ZodObject<{
            street: z.ZodString;
            street2: z.ZodOptional<z.ZodString>;
            city: z.ZodString;
            region: z.ZodString;
            postalCode: z.ZodString;
            country: z.ZodLiteral<"US">;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    authorizedRep: z.ZodOptional<z.ZodObject<{
        firstName: z.ZodString;
        lastName: z.ZodString;
        businessTitle: z.ZodString;
        jobPosition: z.ZodEnum<{
            Director: "Director";
            GM: "GM";
            VP: "VP";
            CEO: "CEO";
            CFO: "CFO";
            "General Counsel": "General Counsel";
            Other: "Other";
        }>;
        phone: z.ZodString;
        email: z.ZodEmail;
    }, z.core.$strict>>;
    soleProprietor: z.ZodOptional<z.ZodObject<{
        firstName: z.ZodString;
        lastName: z.ZodString;
        brandName: z.ZodString;
        email: z.ZodEmail;
        phone: z.ZodString;
        /** Receives Twilio's YES text; can't be a Twilio/CPaaS number; ≤ 3 uses across TCR. */
        mobilePhone: z.ZodString;
        address: z.ZodObject<{
            street: z.ZodString;
            street2: z.ZodOptional<z.ZodString>;
            city: z.ZodString;
            region: z.ZodString;
            postalCode: z.ZodString;
            country: z.ZodLiteral<"US">;
        }, z.core.$strict>;
    }, z.core.$strict>>;
}, z.core.$strict>;
type SmsRegistrationRequest = z.infer<typeof smsRegistrationRequest>;
/** POST /api/provisioning/sms-registration/otp body (sole proprietor: send a new code). */
declare const smsOtpRequest: z.ZodObject<{
    tenantId: z.ZodString;
    relloAgentId: z.ZodString;
}, z.core.$strict>;
type SmsOtpRequest = z.infer<typeof smsOtpRequest>;
/**
 * `number_pending`: the team's business is approved; this loan officer's number
 * is being set up.
 * `suspended`: the brand or campaign is suspended at Twilio. Not terminal, no
 * refund, no new charge. A LIVE loan officer on a suspended business also
 * DISPLAYS `suspended` with `phoneNumber: null` (its row stays live for money,
 * is never refunded, and shows `live` again on reinstatement).
 * A suspension FINAL adds no status: waiting loan officers read `rejected`, then
 * `refunded`. An ambiguous provider create adds no status either.
 */
declare const smsRegistrationStatus: z.ZodEnum<{
    refunded: "refunded";
    details_received: "details_received";
    payment_pending: "payment_pending";
    submitted: "submitted";
    brand_pending: "brand_pending";
    brand_approved: "brand_approved";
    otp_pending: "otp_pending";
    campaign_pending: "campaign_pending";
    number_pending: "number_pending";
    live: "live";
    action_needed: "action_needed";
    suspended: "suspended";
    rejected: "rejected";
}>;
type SmsRegistrationStatus = z.infer<typeof smsRegistrationStatus>;
/** The registration envelope: sms.registration_changed `data`, the registration and OTP route answers, and the GET. */
declare const smsRegistrationEnvelope: z.ZodObject<{
    tenantId: z.ZodString;
    relloAgentId: z.ZodString;
    brandType: z.ZodEnum<{
        STANDARD: "STANDARD";
        SOLE_PROPRIETOR: "SOLE_PROPRIETOR";
    }>;
    status: z.ZodEnum<{
        refunded: "refunded";
        details_received: "details_received";
        payment_pending: "payment_pending";
        submitted: "submitted";
        brand_pending: "brand_pending";
        brand_approved: "brand_approved";
        otp_pending: "otp_pending";
        campaign_pending: "campaign_pending";
        number_pending: "number_pending";
        live: "live";
        action_needed: "action_needed";
        suspended: "suspended";
        rejected: "rejected";
    }>;
    /** Twilio's code + text, sanitized. */
    reason: z.ZodNullable<z.ZodString>;
    fieldsToFix: z.ZodNullable<z.ZodArray<z.ZodString>>;
    /** STANDARD: 3 − the BUSINESS's used count (shared by the team); SOLE_PROPRIETOR: null. */
    remainingFreeUpdates: z.ZodNullable<z.ZodNumber>;
    /** Only when `live`. */
    phoneNumber: z.ZodNullable<z.ZodString>;
    /** Only for SOLE_PROPRIETOR. Expires 24 h after; a new code is available 60 s after. */
    otpSentAt: z.ZodNullable<z.ZodISODateTime>;
    rev: z.ZodNumber;
    occurredAt: z.ZodISODateTime;
}, z.core.$strict>;
type SmsRegistrationEnvelope = z.infer<typeof smsRegistrationEnvelope>;
/**
 * 409 on POST sms-registration and POST sms-registration/otp:
 *   business_rejected         the business is rejected; send the business details again (RENEW)
 *   business_suspended        suspended at Twilio; no write, no charge, no Twilio call
 *   business_suspension_final GD-1763: closed by the carriers; ANY body is refused until Rello's
 *                             operator records the provider outcome; then fresh business details renew once
 *   in_review                 submitted … campaign_pending, otp_pending, live
 *   no_free_updates           action_needed on a brand fix with 0 free updates left
 *   not_otp_pending           OTP route: the registration is not waiting for a code
 * `envelope` is null only when this MLO has no registration row yet.
 * Other answers: 400 invalid_field · 401 · 403 · 404 agent_not_found ·
 * 409 { error: "agent_not_eligible" } · OTP 429 { error: "otp_recently_sent", retryAfterSeconds } ·
 * OTP 502 { error: "twilio_unavailable", retryable: true } · 500 internalError.
 */
declare const registrationConflict: z.ZodObject<{
    error: z.ZodEnum<{
        business_suspended: "business_suspended";
        business_suspension_final: "business_suspension_final";
        business_rejected: "business_rejected";
        in_review: "in_review";
        no_free_updates: "no_free_updates";
        not_otp_pending: "not_otp_pending";
    }>;
    envelope: z.ZodNullable<z.ZodObject<{
        tenantId: z.ZodString;
        relloAgentId: z.ZodString;
        brandType: z.ZodEnum<{
            STANDARD: "STANDARD";
            SOLE_PROPRIETOR: "SOLE_PROPRIETOR";
        }>;
        status: z.ZodEnum<{
            refunded: "refunded";
            details_received: "details_received";
            payment_pending: "payment_pending";
            submitted: "submitted";
            brand_pending: "brand_pending";
            brand_approved: "brand_approved";
            otp_pending: "otp_pending";
            campaign_pending: "campaign_pending";
            number_pending: "number_pending";
            live: "live";
            action_needed: "action_needed";
            suspended: "suspended";
            rejected: "rejected";
        }>;
        /** Twilio's code + text, sanitized. */
        reason: z.ZodNullable<z.ZodString>;
        fieldsToFix: z.ZodNullable<z.ZodArray<z.ZodString>>;
        /** STANDARD: 3 − the BUSINESS's used count (shared by the team); SOLE_PROPRIETOR: null. */
        remainingFreeUpdates: z.ZodNullable<z.ZodNumber>;
        /** Only when `live`. */
        phoneNumber: z.ZodNullable<z.ZodString>;
        /** Only for SOLE_PROPRIETOR. Expires 24 h after; a new code is available 60 s after. */
        otpSentAt: z.ZodNullable<z.ZodISODateTime>;
        rev: z.ZodNumber;
        occurredAt: z.ZodISODateTime;
    }, z.core.$strict>>;
}, z.core.$strict>;
type RegistrationConflict = z.infer<typeof registrationConflict>;
/** Envelope occurredAt = data.occurredAt. */
declare const setupChargeChangedEvent: z.ZodObject<{
    id: z.ZodUUID;
    type: z.ZodLiteral<"billing.setup_charge_changed">;
    tenantId: z.ZodString;
    occurredAt: z.ZodISODateTime;
    data: z.ZodObject<{
        tenantId: z.ZodString;
        relloAgentId: z.ZodString;
        feeSlug: z.ZodString;
        status: z.ZodEnum<{
            failed: "failed";
            unknown: "unknown";
            manual: "manual";
            pending: "pending";
            paid: "paid";
            refunded: "refunded";
            voided: "voided";
        }>;
        /** true only when a PAID row is asked again. */
        alreadyPaid: z.ZodOptional<z.ZodBoolean>;
        /** failed: Stripe's decline message (never card data); manual: the reason in words. */
        message: z.ZodOptional<z.ZodString>;
        chargeId: z.ZodNullable<z.ZodString>;
        rev: z.ZodNumber;
        /** Display only; order by `rev`. */
        occurredAt: z.ZodISODateTime;
    }, z.core.$strict>;
}, z.core.$strict>;
type SetupChargeChangedEvent = z.infer<typeof setupChargeChangedEvent>;
declare const smsRegistrationChangedEvent: z.ZodObject<{
    id: z.ZodUUID;
    type: z.ZodLiteral<"sms.registration_changed">;
    tenantId: z.ZodString;
    occurredAt: z.ZodISODateTime;
    data: z.ZodObject<{
        tenantId: z.ZodString;
        relloAgentId: z.ZodString;
        brandType: z.ZodEnum<{
            STANDARD: "STANDARD";
            SOLE_PROPRIETOR: "SOLE_PROPRIETOR";
        }>;
        status: z.ZodEnum<{
            refunded: "refunded";
            details_received: "details_received";
            payment_pending: "payment_pending";
            submitted: "submitted";
            brand_pending: "brand_pending";
            brand_approved: "brand_approved";
            otp_pending: "otp_pending";
            campaign_pending: "campaign_pending";
            number_pending: "number_pending";
            live: "live";
            action_needed: "action_needed";
            suspended: "suspended";
            rejected: "rejected";
        }>;
        /** Twilio's code + text, sanitized. */
        reason: z.ZodNullable<z.ZodString>;
        fieldsToFix: z.ZodNullable<z.ZodArray<z.ZodString>>;
        /** STANDARD: 3 − the BUSINESS's used count (shared by the team); SOLE_PROPRIETOR: null. */
        remainingFreeUpdates: z.ZodNullable<z.ZodNumber>;
        /** Only when `live`. */
        phoneNumber: z.ZodNullable<z.ZodString>;
        /** Only for SOLE_PROPRIETOR. Expires 24 h after; a new code is available 60 s after. */
        otpSentAt: z.ZodNullable<z.ZodISODateTime>;
        rev: z.ZodNumber;
        occurredAt: z.ZodISODateTime;
    }, z.core.$strict>;
}, z.core.$strict>;
type SmsRegistrationChangedEvent = z.infer<typeof smsRegistrationChangedEvent>;

/**
 * PFP Gateway G-10R + G-EXTRAS (PKG-2): the plan-switch and add-on quantity
 * contract between Rello's v1 billing routes and PathfinderPro's callers.
 * Spec SPEC-PFP-GATEWAY.md G-10R (D47, K-248, H-172); plan a7-1147 §F/§P;
 * Platform KA prompt 1199. One contract, imported by both sides.
 *
 * Auth on every route: `Authorization: Bearer <ApiKey>` (Rello's ApiKey table,
 * targetApp RELLO) plus §4.2's tenant match. The tenant, the Stripe customer,
 * subscriptions and items are never taken from a body or query.
 *
 *   GET   /api/v1/billing/plan-switch/preview?targetPlanSlug=&interval=   (G-10R-2)
 *   POST  /api/v1/billing/plan-switch                                     (G-10R-2)
 *   GET   /api/v1/billing/plan-switch/[operationId]                       (G-10R-2)
 *   PATCH /api/v1/billing/add-on/[addOnId]  + `X-Idempotency-Key` header  (R1, generalized by X1)
 */

declare const PLAN_SWITCH_INTERVALS: readonly ["month", "year"];
type PlanSwitchInterval = (typeof PLAN_SWITCH_INTERVALS)[number];
/**
 * Add-ons a Pro/Team -> Starter/Rates switch can keep instead of dropping (K1, v2.42.0).
 * Today only Refi Radar. Absent = drop, exactly as before.
 */
declare const PLAN_SWITCH_KEEP_ADDONS: readonly ["refi-radar"];
type PlanSwitchKeepAddOn = (typeof PLAN_SWITCH_KEEP_ADDONS)[number];
/**
 * Query of `GET /api/v1/billing/plan-switch/preview`. `interval` absent = the current one.
 * `keepAddOns` (v2.42.0): `refi-radar` to keep Refi Radar through the switch; the param may be
 * repeated in the URL and each value is checked against {@link PLAN_SWITCH_KEEP_ADDONS}; absent = drop.
 */
declare const planSwitchPreviewQuerySchema: z.ZodObject<{
    targetPlanSlug: z.ZodString;
    interval: z.ZodOptional<z.ZodEnum<{
        month: "month";
        year: "year";
    }>>;
    keepAddOns: z.ZodOptional<z.ZodEnum<{
        "refi-radar": "refi-radar";
    }>>;
}, z.core.$strict>;
type PlanSwitchPreviewQuery = z.infer<typeof planSwitchPreviewQuerySchema>;
/** One line of Stripe's own preview invoice for one subscription. Amounts in the currency's minor unit. */
interface PlanSwitchPreviewLine {
    description: string;
    amount: number;
    currency: string;
    /** ISO timestamps. */
    period: {
        start: string;
        end: string;
    };
    proration: boolean;
}
/** Each subscription that will change gets its own preview; one invoice never covers both. */
interface PlanSwitchPreviewSubscription {
    kind: "plan" | "addon";
    lines: PlanSwitchPreviewLine[];
    total: number;
}
/**
 * 200 of the preview. Rello stores the preview (with the inputs it was computed
 * from) and issues `previewId`; a confirmed POST names it, so the numbers the
 * MLO confirmed are the numbers charged. Valid until `expiresAt`
 * (= min(prorationDate + 15 min, the plan period end)).
 */
interface PlanSwitchPreviewResponse {
    previewId: string;
    /** ISO. */
    expiresAt: string;
    /** ISO. The proration instant both steps use when the POST names this preview. */
    prorationDate: string;
    /** true for Pro/Team → Starter/Rates (D47): the POST must carry this previewId and `confirmedChargeChange: true`. */
    requiresConfirmation: boolean;
    subscriptions: PlanSwitchPreviewSubscription[];
    planChange: {
        from: string;
        to: string;
        fromInterval: PlanSwitchInterval;
        toInterval: PlanSwitchInterval;
    };
    /** `refiRadarKept` (v2.42.0) is present only when the server answers the keep-add-ons question; absent is not `false`. */
    chargeChange: {
        carriedCheckYourRateSeat: boolean;
        refiRadarDrops: boolean;
        refiRadarKept?: boolean;
    };
}
/**
 * Body of `POST /api/v1/billing/plan-switch`, as Rello parses it (strict: no
 * tenant, no D47 options; those are fixed server-side).
 *
 * `confirmedChargeChange` is deliberately `unknown` here: a non-boolean must
 * reach switchPlan()'s `=== true` check and get `confirmation_required`, never a
 * generic `invalid_body`, and nothing can default it. Callers build the body as
 * {@link PlanSwitchRequest}.
 */
declare const planSwitchRequestSchema: z.ZodObject<{
    targetPlanSlug: z.ZodString;
    interval: z.ZodOptional<z.ZodEnum<{
        month: "month";
        year: "year";
    }>>;
    idempotencyKey: z.ZodString;
    previewId: z.ZodOptional<z.ZodString>;
    confirmedChargeChange: z.ZodOptional<z.ZodUnknown>;
    keepAddOns: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        "refi-radar": "refi-radar";
    }>>>;
}, z.core.$strict>;
type PlanSwitchRequestParsed = z.infer<typeof planSwitchRequestSchema>;
/** What PFP sends. A downgrade (D47) carries the preview's `previewId` and `confirmedChargeChange: true`, from the one confirmation screen. */
interface PlanSwitchRequest {
    targetPlanSlug: string;
    interval?: PlanSwitchInterval;
    idempotencyKey: string;
    previewId?: string;
    confirmedChargeChange?: true;
    /** v2.42.0 (K1): at most one entry, today `["refi-radar"]`. Absent = drop. */
    keepAddOns?: PlanSwitchKeepAddOn[];
}
type PlanSwitchOperationStatus = "OPEN" | "APPLIED" | "FAILED" | "COMPENSATED";
type PlanSwitchStepState = "PENDING" | "IN_FLIGHT" | "DONE";
interface PlanSwitchStep {
    index: number;
    kind: string;
    state: PlanSwitchStepState;
}
/** 200: the switch finished inside the request. */
interface PlanSwitchAppliedResponse {
    operationId: string;
    status: "APPLIED";
    steps: PlanSwitchStep[];
    planSlug: string;
    interval: PlanSwitchInterval;
    invoiceIds: string[];
}
/** 202: still running; poll `GET /api/v1/billing/plan-switch/[operationId]`. */
interface PlanSwitchOpenResponse {
    operationId: string;
    status: "OPEN";
}
type PlanSwitchResponse = PlanSwitchAppliedResponse | PlanSwitchOpenResponse;
/** `GET /api/v1/billing/plan-switch/[operationId]`. Another tenant's id answers 404 `operation_not_found`. */
interface PlanSwitchOperationResponse {
    operationId: string;
    status: PlanSwitchOperationStatus;
    steps: PlanSwitchStep[];
    previewId: string | null;
    invoiceIds: string[];
    resolutionNeeded: boolean;
    /** ISO, while the provider outcome is unknown; else null. */
    unknownSince: string | null;
}
/**
 * Every `error` the plan-switch routes answer. Each one is a billing action
 * refused, never a send gate.
 *
 *  400 invalid_body · switch_not_allowed · contact_sales · addon_price_not_configured ·
 *      confirmation_required (a D47 downgrade without previewId + confirmedChargeChange === true) ·
 *      addon_not_offered (v2.42.0: keepAddOns names an add-on the tenant doesn't hold, or the target plan can't carry)
 *  402 payment_failed (step 1 declined; nothing applied)
 *  404 operation_not_found
 *  409 idempotency_key_reused · members_exceed_target · billing_mode_classic · already_on_plan ·
 *      preview_stale (expired / mismatched / another tenant's / its inputs changed) · preview_consumed ·
 *      stale_switch · switch_in_progress · use_plan_switch (the subscription PUT and the admin plan
 *      field for a gateway tenant)
 *  503 provider_unreadable (outcome unknown: poll the GET) · not_armed (the open rolled back:
 *      retry with the same idempotencyKey)
 */
declare const PLAN_SWITCH_ERROR_CODES: readonly ["invalid_body", "idempotency_key_reused", "switch_not_allowed", "contact_sales", "members_exceed_target", "addon_price_not_configured", "billing_mode_classic", "already_on_plan", "confirmation_required", "preview_stale", "preview_consumed", "stale_switch", "switch_in_progress", "payment_failed", "provider_unreadable", "not_armed", "use_plan_switch", "operation_not_found", "addon_not_offered"];
type PlanSwitchErrorCode = (typeof PLAN_SWITCH_ERROR_CODES)[number];
/**
 * Why a preview is stale (GD-1778). Optional and additive: an absent reason is
 * the round-2 meaning (expired or mismatched).
 *  - inputs_changed: an add-on quantity, a new add-on row or a catalog price id changed
 *    since the preview. 0 operations and 0 Stripe calls of any kind.
 *  - provider_changed: Stripe's plan price, period end, an add-on item, or the
 *    add-on subscription's trial state differs from what the preview read. The shared reader's two reads, each ≤ 1 bounded retry; 0 mutations.
 *  - expired: past `expiresAt`.
 * What PFP does for any of them: fetch a fresh preview and confirm again.
 */
declare const PREVIEW_STALE_REASONS: readonly ["inputs_changed", "provider_changed", "expired"];
type PreviewStaleReason = (typeof PREVIEW_STALE_REASONS)[number];
/**
 * `409 preview_stale`. `reason` is a plain string on the wire (like `cause`), so
 * a reason Rello adds later never makes an older PFP refuse the answer; compare
 * it against {@link PREVIEW_STALE_REASONS}.
 */
declare const previewStaleErrorSchema: z.ZodObject<{
    error: z.ZodLiteral<"preview_stale">;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type PreviewStaleError = z.infer<typeof previewStaleErrorSchema>;
/**
 * `409 members_exceed_target` (KA 1229 ruling for PFP K-345/O-10, 2026-11-17):
 * the target plan allows fewer logins than the account has active, so the
 * switch is refused with nothing changed. The counts follow the X1 quantity
 * PATCH's `members_exceed_quantity` (`{ activeMembers, quantity }`, Rello
 * src/lib/billing/addon-quantity.ts:297 @be87ded94): `activeMembers` the
 * active logins now, `targetLimit` what the target plan allows. Exact: no other
 * field, so a count can never arrive under another name.
 */
declare const membersExceedTargetErrorSchema: z.ZodObject<{
    error: z.ZodLiteral<"members_exceed_target">;
    activeMembers: z.ZodNumber;
    targetLimit: z.ZodNumber;
    message: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
type MembersExceedTargetError = z.infer<typeof membersExceedTargetErrorSchema>;
type PlanSwitchError = PreviewStaleError | {
    error: "switch_in_progress";
    operationId: string;
} | MembersExceedTargetError | {
    error: Exclude<PlanSwitchErrorCode, "preview_stale" | "switch_in_progress" | "members_exceed_target">;
    message?: string;
};
declare const planSwitchPreviewLineSchema: z.ZodObject<{
    description: z.ZodString;
    amount: z.ZodNumber;
    currency: z.ZodString;
    period: z.ZodObject<{
        start: z.ZodString;
        end: z.ZodString;
    }, z.core.$strip>;
    proration: z.ZodBoolean;
}, z.core.$strip>;
declare const planSwitchPreviewSubscriptionSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        plan: "plan";
        addon: "addon";
    }>;
    lines: z.ZodArray<z.ZodObject<{
        description: z.ZodString;
        amount: z.ZodNumber;
        currency: z.ZodString;
        period: z.ZodObject<{
            start: z.ZodString;
            end: z.ZodString;
        }, z.core.$strip>;
        proration: z.ZodBoolean;
    }, z.core.$strip>>;
    total: z.ZodNumber;
}, z.core.$strip>;
/** 200 of GET /api/v1/billing/plan-switch/preview. */
declare const planSwitchPreviewResponseSchema: z.ZodObject<{
    previewId: z.ZodString;
    expiresAt: z.ZodString;
    prorationDate: z.ZodString;
    requiresConfirmation: z.ZodBoolean;
    subscriptions: z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<{
            plan: "plan";
            addon: "addon";
        }>;
        lines: z.ZodArray<z.ZodObject<{
            description: z.ZodString;
            amount: z.ZodNumber;
            currency: z.ZodString;
            period: z.ZodObject<{
                start: z.ZodString;
                end: z.ZodString;
            }, z.core.$strip>;
            proration: z.ZodBoolean;
        }, z.core.$strip>>;
        total: z.ZodNumber;
    }, z.core.$strip>>;
    planChange: z.ZodObject<{
        from: z.ZodString;
        to: z.ZodString;
        fromInterval: z.ZodEnum<{
            month: "month";
            year: "year";
        }>;
        toInterval: z.ZodEnum<{
            month: "month";
            year: "year";
        }>;
    }, z.core.$strip>;
    chargeChange: z.ZodObject<{
        carriedCheckYourRateSeat: z.ZodBoolean;
        refiRadarDrops: z.ZodBoolean;
        refiRadarKept: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
}, z.core.$strip>;
declare const planSwitchStepSchema: z.ZodObject<{
    index: z.ZodNumber;
    kind: z.ZodString;
    state: z.ZodEnum<{
        PENDING: "PENDING";
        IN_FLIGHT: "IN_FLIGHT";
        DONE: "DONE";
    }>;
}, z.core.$strip>;
/** 200 of POST /api/v1/billing/plan-switch: finished inside the request. */
declare const planSwitchAppliedResponseSchema: z.ZodObject<{
    operationId: z.ZodString;
    status: z.ZodLiteral<"APPLIED">;
    steps: z.ZodArray<z.ZodObject<{
        index: z.ZodNumber;
        kind: z.ZodString;
        state: z.ZodEnum<{
            PENDING: "PENDING";
            IN_FLIGHT: "IN_FLIGHT";
            DONE: "DONE";
        }>;
    }, z.core.$strip>>;
    planSlug: z.ZodString;
    interval: z.ZodEnum<{
        month: "month";
        year: "year";
    }>;
    invoiceIds: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
/** 202 of POST /api/v1/billing/plan-switch: still running; poll the operation. */
declare const planSwitchOpenResponseSchema: z.ZodObject<{
    operationId: z.ZodString;
    status: z.ZodLiteral<"OPEN">;
}, z.core.$strip>;
declare const planSwitchResponseSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    operationId: z.ZodString;
    status: z.ZodLiteral<"APPLIED">;
    steps: z.ZodArray<z.ZodObject<{
        index: z.ZodNumber;
        kind: z.ZodString;
        state: z.ZodEnum<{
            PENDING: "PENDING";
            IN_FLIGHT: "IN_FLIGHT";
            DONE: "DONE";
        }>;
    }, z.core.$strip>>;
    planSlug: z.ZodString;
    interval: z.ZodEnum<{
        month: "month";
        year: "year";
    }>;
    invoiceIds: z.ZodArray<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    operationId: z.ZodString;
    status: z.ZodLiteral<"OPEN">;
}, z.core.$strip>], "status">;
/** 200 of GET /api/v1/billing/plan-switch/[operationId]. */
declare const planSwitchOperationResponseSchema: z.ZodObject<{
    operationId: z.ZodString;
    status: z.ZodEnum<{
        OPEN: "OPEN";
        APPLIED: "APPLIED";
        FAILED: "FAILED";
        COMPENSATED: "COMPENSATED";
    }>;
    steps: z.ZodArray<z.ZodObject<{
        index: z.ZodNumber;
        kind: z.ZodString;
        state: z.ZodEnum<{
            PENDING: "PENDING";
            IN_FLIGHT: "IN_FLIGHT";
            DONE: "DONE";
        }>;
    }, z.core.$strip>>;
    previewId: z.ZodNullable<z.ZodString>;
    invoiceIds: z.ZodArray<z.ZodString>;
    resolutionNeeded: z.ZodBoolean;
    unknownSince: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
/** `409 switch_in_progress`: another switch for this tenant is running; poll it. */
declare const switchInProgressErrorSchema: z.ZodObject<{
    error: z.ZodLiteral<"switch_in_progress">;
    operationId: z.ZodString;
}, z.core.$strip>;
type SwitchInProgressError = z.infer<typeof switchInProgressErrorSchema>;
/**
 * The plan-switch codes that have their own exact schema. A body naming one of
 * these is that refusal or nothing: it never parses through the open branch
 * below (AUDIT 111 GD-2146, KA 1275).
 */
declare const PLAN_SWITCH_DEDICATED_ERROR_CODES: readonly ["members_exceed_target", "preview_stale", "switch_in_progress"];
/**
 * Any OTHER plan-switch refusal: `{ error: <code>, message? }`, for every code
 * that has no dedicated schema. `error` is a plain string on the wire (like
 * preview_stale's `reason`), so a code Rello adds later is still an answer;
 * compare it against {@link PLAN_SWITCH_ERROR_CODES}. Extra fields are kept.
 * A code in {@link PLAN_SWITCH_DEDICATED_ERROR_CODES} is refused here: it must
 * pass its own schema.
 */
declare const planSwitchOtherErrorSchema: z.ZodObject<{
    error: z.ZodString;
    message: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
type PlanSwitchOtherError = z.infer<typeof planSwitchOtherErrorSchema>;
/**
 * Every plan-switch refusal. A body naming `members_exceed_target`,
 * `preview_stale` or `switch_in_progress` parses only through that code's own
 * schema, so a malformed one (missing or negative counts, a non-string reason,
 * no operationId) is refused, never accepted through the open branch. Any other
 * code, a future one included, parses through the open branch.
 */
declare const planSwitchErrorSchema: z.ZodUnion<readonly [z.ZodObject<{
    error: z.ZodLiteral<"members_exceed_target">;
    activeMembers: z.ZodNumber;
    targetLimit: z.ZodNumber;
    message: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    error: z.ZodLiteral<"preview_stale">;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    error: z.ZodLiteral<"switch_in_progress">;
    operationId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    error: z.ZodString;
    message: z.ZodOptional<z.ZodString>;
}, z.core.$loose>]>;
declare function isMembersExceedTargetError(e: unknown): e is MembersExceedTargetError;
/**
 * The idempotency key travels in this header, 8–128 characters (R1's
 * `src/lib/billing/v1/idempotency-header.ts`). A missing or malformed one is
 * refused before anything else (`IDEMPOTENCY_KEY_REQUIRED` / `_INVALID`).
 */
declare const ADDON_QUANTITY_IDEMPOTENCY_HEADER: "X-Idempotency-Key";
declare const ADDON_QUANTITY_IDEMPOTENCY_KEY_LENGTH: Readonly<{
    readonly min: 8;
    readonly max: 128;
}>;
/**
 * Body of `PATCH /api/v1/billing/add-on/[addOnId]`. `quantity` is absolute
 * (0 removes the item); `quantityRev` is the caller's monotonic revision, a
 * non-negative number or, past 2^53, a digit string. The key travels in the
 * {@link ADDON_QUANTITY_IDEMPOTENCY_HEADER} header. Strict: the tenant comes from auth.
 */
declare const addOnQuantityRequestSchema: z.ZodObject<{
    quantity: z.ZodNumber;
    quantityRev: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>;
type AddOnQuantityRequest = z.infer<typeof addOnQuantityRequestSchema>;
/**
 * 200 `{ success: true, data }`. R1 (#2361/#2381) sends the first five fields.
 * `status` and `subscriptionCanceled` are added by X1 (the generic PATCH); a
 * reader must treat them as absent on an R1 answer.
 */
declare const addOnQuantityResponseSchema: z.ZodObject<{
    tenantAddOnId: z.ZodString;
    quantity: z.ZodNumber;
    quantityRev: z.ZodString;
    billedQuantity: z.ZodNumber;
    superseded: z.ZodBoolean;
    status: z.ZodOptional<z.ZodString>;
    subscriptionCanceled: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
type AddOnQuantityResponse = z.infer<typeof addOnQuantityResponseSchema>;
/**
 * The domain `code`s the quantity PATCH answers. Each refuses a billing action;
 * none is a send gate.
 *
 *  409 members_exceed_quantity    pfp-extra-team-login below the active login members
 *                                  (`{ activeMembers, quantity }`); 0 Stripe calls (X1)
 *  409 extra_mlos_exceed_quantity pfp-extra-signature below the active loginless MLOs
 *                                  (`{ activeLoginless, quantity }`); 0 Stripe calls (X1)
 *  409 stale_quantity_rev · 400 contact_sales (above the add-on's maxQuantity) ·
 *  400 included_in_plan (Refi Radar on Pro/Team) · addon_price_not_configured
 *  R1's own: 404 addon_not_found · 409 addon_not_active · 409 addon_state_unknown ·
 *  409 quantity_not_supported · 402 payment_method_required · 502 stripe_failed
 */
declare const ADDON_QUANTITY_ERROR_CODES: readonly ["members_exceed_quantity", "extra_mlos_exceed_quantity", "stale_quantity_rev", "contact_sales", "included_in_plan", "addon_price_not_configured", "addon_not_found", "addon_not_active", "addon_state_unknown", "quantity_not_supported", "payment_method_required", "stripe_failed"];
type AddOnQuantityErrorCode = (typeof ADDON_QUANTITY_ERROR_CODES)[number];
/** The idempotency refusals every v1 billing mutation shares (uppercase, as R1 sends them): 400, 400, 422. */
declare const ADDON_QUANTITY_IDEMPOTENCY_ERROR_CODES: readonly ["IDEMPOTENCY_KEY_REQUIRED", "IDEMPOTENCY_KEY_INVALID", "IDEMPOTENCY_KEY_CONFLICT"];
type AddOnQuantityIdempotencyErrorCode = (typeof ADDON_QUANTITY_IDEMPOTENCY_ERROR_CODES)[number];
/** 409 extra_mlos_exceed_quantity, exactly. */
declare const extraMlosExceedQuantityErrorSchema: z.ZodObject<{
    success: z.ZodLiteral<false>;
    error: z.ZodString;
    code: z.ZodLiteral<"extra_mlos_exceed_quantity">;
    activeLoginless: z.ZodNumber;
    quantity: z.ZodNumber;
}, z.core.$strip>;
type ExtraMlosExceedQuantityError = z.infer<typeof extraMlosExceedQuantityErrorSchema>;
/** 409 members_exceed_quantity, exactly. */
declare const membersExceedQuantityErrorSchema: z.ZodObject<{
    success: z.ZodLiteral<false>;
    error: z.ZodString;
    code: z.ZodLiteral<"members_exceed_quantity">;
    activeMembers: z.ZodNumber;
    quantity: z.ZodNumber;
}, z.core.$strip>;
type MembersExceedQuantityError = z.infer<typeof membersExceedQuantityErrorSchema>;
/**
 * Any other refusal the route gives. Not every answer carries a `code` or even
 * `success`: R1's 400 invalid body, 404 add-on not found, 403 other app's
 * add-on, 500 and 503 send `{ success: false, error }`; requireV1Auth's 401/403
 * and the tenant-app guard send `{ error }`. A code is one of
 * {@link ADDON_QUANTITY_ERROR_CODES}, {@link ADDON_QUANTITY_IDEMPOTENCY_ERROR_CODES},
 * or one a later Rello adds; extra fields (e.g. `convergence`) are kept.
 */
declare const addOnQuantityOtherErrorSchema: z.ZodObject<{
    success: z.ZodOptional<z.ZodLiteral<false>>;
    error: z.ZodString;
    code: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
type AddOnQuantityOtherError = z.infer<typeof addOnQuantityOtherErrorSchema>;
/** Every refusal of the quantity PATCH. Narrow the exact domain branches with the guards below. */
declare const addOnQuantityErrorSchema: z.ZodUnion<readonly [z.ZodObject<{
    success: z.ZodLiteral<false>;
    error: z.ZodString;
    code: z.ZodLiteral<"extra_mlos_exceed_quantity">;
    activeLoginless: z.ZodNumber;
    quantity: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    success: z.ZodLiteral<false>;
    error: z.ZodString;
    code: z.ZodLiteral<"members_exceed_quantity">;
    activeMembers: z.ZodNumber;
    quantity: z.ZodNumber;
}, z.core.$strip>, z.ZodObject<{
    success: z.ZodOptional<z.ZodLiteral<false>>;
    error: z.ZodString;
    code: z.ZodOptional<z.ZodString>;
}, z.core.$loose>]>;
type AddOnQuantityError = ExtraMlosExceedQuantityError | MembersExceedQuantityError | AddOnQuantityOtherError;
declare function isExtraMlosExceedQuantityError(e: unknown): e is ExtraMlosExceedQuantityError;
declare function isMembersExceedQuantityError(e: unknown): e is MembersExceedQuantityError;

/**
 * PFP Gateway P-1: Rello's tenant-bound v1 billing reads (SPEC-PFP-GATEWAY.md
 * §4.2 "Read-through on unknown"; Platform KA prompt 1221, rulings 1220/1247).
 * One contract for Rello's routes and PathfinderPro's callers.
 *
 *   GET  /api/v1/billing/plan-grants   permission billing:plan-grants:read
 *   GET  /api/v1/billing/add-ons       permission billing:read
 *   POST /api/v1/billing/add-on        permission billing:write  (the start; R1)
 *
 * Auth: `Authorization: Bearer <ApiKey>` (Rello's ApiKey table, targetApp RELLO)
 * with the route's permission, then §4.2's tenant match (Rello's
 * `requireV1TenantMatch`). The tenant is the key's own, or `X-Tenant-Id` for a
 * tenant-null key; never a body. The two reads answer flat JSON (no
 * `{ success, data }` envelope); the POST start keeps R1's envelope.
 */

/**
 * §4.2's three tenant 403 bodies, `{ error }`. They are textually distinct on
 * purpose: one status code, three different causes. A permission 403 is the
 * bare `{ error: "Forbidden" }` from requireV1Auth.
 */
declare const V1_TENANT_MATCH_ERRORS: Readonly<{
    /** A tenant-scoped key sent an X-Tenant-Id naming another tenant. Nothing was read for either. */
    readonly tenantHeaderMismatch: "Forbidden — tenant header does not match credential";
    /** The key's app is not one these routes serve (pathfinder-pro today). */
    readonly callerAppNotAllowed: "Forbidden — caller app not allowed";
}>;
/**
 * The third tenant 403: a tenant-null key whose app is not enabled on the
 * X-Tenant-Id tenant. PathfinderPro resolves it as UNKNOWN (503 with retry),
 * never as "no grants": the app may be enabled a moment later.
 */
declare function appNotEnabledForTenantError(appSlug: string): string;
declare const v1TenantMatchErrorSchema: z.ZodObject<{
    error: z.ZodString;
}, z.core.$strip>;
type V1TenantMatchError = z.infer<typeof v1TenantMatchErrorSchema>;
/**
 * 200. `rev` is Rello's TenantPlanGrantState revision (a BIGINT, served as a
 * safe integer; Rello answers 503 rather than round one it can't carry).
 * `cyr` is REQUIRED and nullable: the tenant's effective Check Your Rate record
 * (spec §4.3, the same fields as `billing.addon_changed`), or `null` when the
 * tenant never held Check Your Rate. A body with no `cyr` key is not this
 * answer, and must not be read as "never held" (A-286).
 */
declare const planGrantsReadResponseSchema: z.ZodObject<{
    rev: z.ZodNumber;
    grants: z.ZodArray<z.ZodString>;
    planSlug: z.ZodString;
    cyr: z.ZodNullable<z.ZodObject<{
        featureSlug: z.ZodString;
        status: z.ZodEnum<{
            ACTIVE: "ACTIVE";
            TRIALING: "TRIALING";
            PAST_DUE: "PAST_DUE";
            CANCELED: "CANCELED";
        }>;
        quantity: z.ZodNumber;
        trialEndsAt: z.ZodNullable<z.ZodString>;
        canceledAt: z.ZodNullable<z.ZodString>;
        occurredAt: z.ZodString;
        seq: z.ZodNumber;
        source: z.ZodEnum<{
            plan: "plan";
            addon: "addon";
            both: "both";
        }>;
        cause: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    trial: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        planSlug: z.ZodString;
        startedAt: z.ZodString;
        endsAt: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
type PlanGrantsReadResponse = z.infer<typeof planGrantsReadResponseSchema>;
/**
 * The read's own refusals, besides the tenant 403s and requireV1Auth's 401/403:
 *  - 404 `no_plan_grants`: the read succeeded and the tenant has no grant state.
 *    For a gateway-origin tenant that is a contract violation (Rello writes the
 *    marker and the state together); the caller still treats it as unknown.
 *  - 503 `plan_grants_unavailable`: Rello could not read the state, or holds a
 *    row it cannot serve. Unknown: retry, never "no grants".
 *
 * `cyr.canceledAt` is always null on this read, CANCELED included (KA ruling
 * 1261): Rello stores no canceledAt for the record, so a CANCELED record comes
 * with `canceledAt: null` and `occurredAt` = the record's last change. Use
 * `occurredAt` as the cancel time; it can only be later than the true one.
 */
declare const PLAN_GRANTS_READ_ERROR_CODES: readonly ["no_plan_grants", "plan_grants_unavailable"];
type PlanGrantsReadErrorCode = (typeof PLAN_GRANTS_READ_ERROR_CODES)[number];
declare const planGrantsReadErrorSchema: z.ZodObject<{
    error: z.ZodEnum<{
        no_plan_grants: "no_plan_grants";
        plan_grants_unavailable: "plan_grants_unavailable";
    }>;
}, z.core.$strip>;
type PlanGrantsReadError = z.infer<typeof planGrantsReadErrorSchema>;
/**
 * What Rello would charge this tenant for ONE unit of the add-on, per interval,
 * in integer cents: the price the POST start charges, read from the catalog row
 * that holds it. No Stripe call.
 *
 * `null` means UNKNOWN, never $0: Rello holds no Stripe price for that interval
 * (a POST would refuse `addon_price_not_configured`) or the amount can't be
 * read. A determined `0` is a real $0. A ONE_TIME add-on has no per-interval
 * price, so both are null and `type` says why.
 */
declare const addOnUnitPriceSchema: z.ZodObject<{
    monthly: z.ZodNullable<z.ZodNumber>;
    yearly: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
type AddOnUnitPrice = z.infer<typeof addOnUnitPriceSchema>;
/**
 * A ONE_TIME add-on's price (PFP Gateway G-LR Part B, Platform KA prompt 1323):
 * `once` is integer cents for one purchase, the price Kelly sets on the add-on
 * in Platform Admin (Rello's "once" catalog slot). `null` means no one-time
 * price is set (unknown, never $0); the key is always present on a ONE_TIME
 * item. A ONE_TIME add-on has no per-interval price, so `monthly` and `yearly`
 * are always null. A RECURRING add-on's price stays `addOnUnitPriceSchema`,
 * with no `once` key.
 */
declare const addOnOneTimePriceSchema: z.ZodObject<{
    monthly: z.ZodNull;
    yearly: z.ZodNull;
    once: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
type AddOnOneTimePrice = z.infer<typeof addOnOneTimePriceSchema>;
/** Rello's SubscriptionStatus values today. `status` parses as a plain string so a later status never fails the read. */
declare const TENANT_ADD_ON_STATUSES: readonly ["ACTIVE", "TRIALING", "PAST_DUE", "CANCELED", "INCOMPLETE"];
/**
 * This tenant's subscription to the add-on (Rello's TenantAddOn), or null when
 * there is none. `quantityRev` is a BIGINT, sent as a decimal string so it is
 * exact past Number.MAX_SAFE_INTEGER; compare it with BigInt(), never Number().
 */
declare const v1AddOnTenantSubscriptionSchema: z.ZodObject<{
    status: z.ZodString;
    quantity: z.ZodNumber;
    requestedQuantity: z.ZodNullable<z.ZodNumber>;
    quantityRev: z.ZodNullable<z.ZodString>;
    trialEndsAt: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
type V1AddOnTenantSubscription = z.infer<typeof v1AddOnTenantSubscriptionSchema>;
/**
 * One add-on the caller's app owns, active or not (`isActive` false = retired
 * from sale; existing subscribers keep it). Discriminated on `type`: a
 * RECURRING item's price is `{ monthly, yearly }` (unchanged); a ONE_TIME
 * item's price also carries `once` (G-LR Part B).
 */
declare const v1AddOnReadSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"RECURRING">;
    price: z.ZodObject<{
        monthly: z.ZodNullable<z.ZodNumber>;
        yearly: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
    id: z.ZodString;
    appSlug: z.ZodString;
    name: z.ZodString;
    isActive: z.ZodBoolean;
    tenantAddOn: z.ZodNullable<z.ZodObject<{
        status: z.ZodString;
        quantity: z.ZodNumber;
        requestedQuantity: z.ZodNullable<z.ZodNumber>;
        quantityRev: z.ZodNullable<z.ZodString>;
        trialEndsAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"ONE_TIME">;
    price: z.ZodObject<{
        monthly: z.ZodNull;
        yearly: z.ZodNull;
        once: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
    id: z.ZodString;
    appSlug: z.ZodString;
    name: z.ZodString;
    isActive: z.ZodBoolean;
    tenantAddOn: z.ZodNullable<z.ZodObject<{
        status: z.ZodString;
        quantity: z.ZodNumber;
        requestedQuantity: z.ZodNullable<z.ZodNumber>;
        quantityRev: z.ZodNullable<z.ZodString>;
        trialEndsAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>], "type">;
type V1AddOnRead = z.infer<typeof v1AddOnReadSchema>;
/**
 * 200. Only the calling app's add-ons, ordered by name then id. Never another
 * app's add-on and never another tenant's subscription.
 *
 * Before PathfinderPro can call this, `billing:read` must be granted to
 * pathfinder-pro and carried on its RELLO-targeted ApiKey.
 */
declare const v1AddOnsReadResponseSchema: z.ZodObject<{
    addOns: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"RECURRING">;
        price: z.ZodObject<{
            monthly: z.ZodNullable<z.ZodNumber>;
            yearly: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        id: z.ZodString;
        appSlug: z.ZodString;
        name: z.ZodString;
        isActive: z.ZodBoolean;
        tenantAddOn: z.ZodNullable<z.ZodObject<{
            status: z.ZodString;
            quantity: z.ZodNumber;
            requestedQuantity: z.ZodNullable<z.ZodNumber>;
            quantityRev: z.ZodNullable<z.ZodString>;
            trialEndsAt: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"ONE_TIME">;
        price: z.ZodObject<{
            monthly: z.ZodNull;
            yearly: z.ZodNull;
            once: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        id: z.ZodString;
        appSlug: z.ZodString;
        name: z.ZodString;
        isActive: z.ZodBoolean;
        tenantAddOn: z.ZodNullable<z.ZodObject<{
            status: z.ZodString;
            quantity: z.ZodNumber;
            requestedQuantity: z.ZodNullable<z.ZodNumber>;
            quantityRev: z.ZodNullable<z.ZodString>;
            trialEndsAt: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>], "type">>;
}, z.core.$strip>;
type V1AddOnsReadResponse = z.infer<typeof v1AddOnsReadResponseSchema>;
/** 503 `add_ons_unavailable`: a read failed. Unknown: retry, never "no add-ons". */
declare const ADD_ONS_READ_ERROR_CODES: readonly ["add_ons_unavailable"];
type AddOnsReadErrorCode = (typeof ADD_ONS_READ_ERROR_CODES)[number];
declare const addOnsReadErrorSchema: z.ZodObject<{
    error: z.ZodEnum<{
        add_ons_unavailable: "add_ons_unavailable";
    }>;
}, z.core.$strip>;
type AddOnsReadError = z.infer<typeof addOnsReadErrorSchema>;
/** The idempotency header the POST requires: 8–128 characters, one per intended start. */
declare const ADD_ON_START_IDEMPOTENCY_HEADER = "X-Idempotency-Key";
/**
 * The body, strict: an unknown field (a coupon, a tenant) is a 400.
 * `quantity` defaults to 1 on Rello. `trial` (Check Your Rate only) asks for the
 * one 14-day no-card trial. `quantityRev` (Check Your Rate) is PFP's monotonic
 * revision of the page count: an integer, or a decimal string of 1–18 digits.
 */
declare const addOnStartRequestSchema: z.ZodObject<{
    addOnId: z.ZodString;
    quantity: z.ZodOptional<z.ZodNumber>;
    trial: z.ZodOptional<z.ZodBoolean>;
    quantityRev: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
}, z.core.$strict>;
type AddOnStartRequest = z.infer<typeof addOnStartRequestSchema>;
/**
 * 200, R1's envelope. A same-key retry answers the first result again.
 * `trialEndsAt` is present for Check Your Rate (null when not trialing) and
 * absent for any other add-on.
 */
declare const addOnStartResponseSchema: z.ZodObject<{
    success: z.ZodLiteral<true>;
    data: z.ZodObject<{
        tenantAddOnId: z.ZodString;
        status: z.ZodString;
        trialEndsAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
}, z.core.$strip>;
type AddOnStartResponse = z.infer<typeof addOnStartResponseSchema>;
/**
 * A refusal from the route itself: `{ success: false, error, code? }` plus the
 * fields a code carries (`needsPaymentMethod`, `coveredSeats`, ...), kept by
 * `.loose()`. `code` is a plain string so a later code never fails the parse.
 * requireV1Auth's own 401/403 are `{ error }` alone (v1TenantMatchErrorSchema).
 */
declare const addOnStartErrorSchema: z.ZodObject<{
    success: z.ZodLiteral<false>;
    error: z.ZodString;
    code: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
type AddOnStartError = z.infer<typeof addOnStartErrorSchema>;
/**
 * The codes R1's Check Your Rate start answers today, for callers that branch on them.
 * `addon_price_not_configured` (409) carries `family`, `interval` and `addOnId`, kept by
 * `.loose()`. The older spelling `addon_pricing_not_configured` is not listed: nothing in
 * Rello main sends it (AUDIT 111 GD-2250); `code` stays an open string, so a body that
 * carries it still parses.
 */
declare const ADD_ON_START_ERROR_CODES: readonly ["not_a_check_your_rate_addon", "payment_method_required", "tenant_not_found", "addon_already_active", "addon_state_unknown", "already_entitled", "engine_required", "trial_already_used", "addon_price_not_configured", "stripe_failed"];
type AddOnStartErrorCode = (typeof ADD_ON_START_ERROR_CODES)[number];

/**
 * PFP Gateway G-10R-2t-A (Platform KA prompt 1451, ruling K11a): the once-per-tenant Full PFP
 * plan trial. The wire contract between Rello (which starts and records the trial) and
 * PathfinderPro (which asks for it and reads its state). Spec: Agent 5's build plan a5-1450 §(b).
 *
 * Permission: `billing:plan-trial:write` (@rello-platform/permissions v0.67.0). The tenant is the
 * key's own, never a body field.
 *
 * Additive: `trial` is optional on the two plan-grants shapes, so an older Rello's body parses
 * unchanged. ABSENT means "this Rello does not say" (unknown), `null` means "the tenant has no
 * trial"; a reader must never turn an absent `trial` into `null`.
 */

/**
 * A tenant's trial as the plan-grants shapes carry it. `startedAt` and `endsAt` are ISO instants.
 * Not strict, like its neighbours: a field Rello adds later is dropped, never a refusal.
 */
declare const planTrialStateSchema: z.ZodObject<{
    planSlug: z.ZodString;
    startedAt: z.ZodString;
    endsAt: z.ZodString;
}, z.core.$strip>;
type PlanTrialState = z.infer<typeof planTrialStateSchema>;
/**
 * Body of the trial start. Strict: no tenant, no dates; those are Rello's. `trialPlanSlug` is
 * OPTIONAL (KA amendment 1454): the trial plan is pinned by grant, so an empty body `{}` is valid and
 * Rello picks the one Plan that carries the pfp-full grant. A slug sent must match it
 * (`unknown_trial_plan` otherwise).
 */
declare const planTrialStartRequestSchema: z.ZodObject<{
    trialPlanSlug: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
type PlanTrialStartRequest = z.infer<typeof planTrialStartRequestSchema>;
/** 200 of the trial start. `rev` is the tenant's plan-grants revision after the trial began. */
declare const planTrialStartResponseSchema: z.ZodObject<{
    trialId: z.ZodString;
    trialPlanSlug: z.ZodString;
    startedAt: z.ZodString;
    endsAt: z.ZodString;
    rev: z.ZodNumber;
}, z.core.$strip>;
type PlanTrialStartResponse = z.infer<typeof planTrialStartResponseSchema>;
/**
 * Every `error` the trial start answers. `trial` rides on `trial_already_used` (the trial the tenant
 * already had). Each is a billing action refused, never a send gate.
 *  400 unknown_trial_plan (the slug sent does not match the Full plan) · invalid_body
 *  409 trial_plan_unknown (zero or several Plans carry the pfp-full grant, so the server cannot tell
 *      which is Full; KA amendment 1454) · trial_already_used · already_entitled · switch_in_progress ·
 *      switch_not_allowed
 *  not_gateway_tenant · plan_trial_unavailable as Rello answers them
 */
declare const PLAN_TRIAL_START_ERROR_CODES: readonly ["trial_already_used", "already_entitled", "not_gateway_tenant", "switch_in_progress", "switch_not_allowed", "unknown_trial_plan", "trial_plan_unknown", "invalid_body", "plan_trial_unavailable"];
type PlanTrialStartErrorCode = (typeof PLAN_TRIAL_START_ERROR_CODES)[number];
/**
 * A refusal body `{ error, trial? }`. `error` is a plain non-empty string and `.loose()` keeps any extra
 * field, like the add-on charge-once and plan-switch refusals, so a code Rello adds later still parses:
 * compare it with {@link PLAN_TRIAL_START_ERROR_CODES} and treat a code not in the list as a refusal
 * you cannot name (never as "no trial"). `trial`, when present, carries its `status`.
 */
declare const planTrialStartErrorSchema: z.ZodObject<{
    error: z.ZodString;
    trial: z.ZodOptional<z.ZodObject<{
        planSlug: z.ZodString;
        startedAt: z.ZodString;
        endsAt: z.ZodString;
        status: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$loose>;
type PlanTrialStartError = z.infer<typeof planTrialStartErrorSchema>;

/**
 * PFP Gateway P-2: the embed token and F2 (tenant app access). One contract for
 * Rello's v1 routes and their two callers, PathfinderPro and Home Scout.
 * Map MAP-P2-EMBED-TOKEN-F2-261118.md
 * (sha256 114f1378ecda0a07cf5c5ba402c9481ffd8b99ea5453465e16746d7f046d7768),
 * Platform KA prompt 1306.
 *
 * Rello mints a short-lived opaque token (`rpe_…`) so a Home Scout page can open
 * inside PathfinderPro. Home Scout never trusts the token itself: it asks Rello.
 * F2 lets Home Scout ask Rello whether PathfinderPro may act for a tenant.
 *
 *   POST /api/v1/embed-tokens                          PathfinderPro → Rello   (201 mint)
 *   POST /api/v1/embed-tokens/verify                   Home Scout → Rello      (200 verdict)
 *   GET  /api/v1/platform/tenant-app-access?tenantId=  Home Scout → Rello      (200 F2)
 *
 * Auth on every route: `Authorization: Bearer <ApiKey>` (Rello's ApiKey table,
 * targetApp RELLO). The mint's tenant comes from the key, never from the body.
 *
 * Refusals are `{ error: <code> }` with a code from {@link EMBED_TOKEN_ERRORS}.
 *
 * Module-level helpers carry an `embedToken` prefix so tsup renames nothing else
 * in the bundle.
 */

/** The Home Scout page PathfinderPro wants to embed. */
declare const EMBED_SURFACES: readonly ["identity", "rate-widget"];
type EmbedSurface = (typeof EMBED_SURFACES)[number];
/** What a token lets Home Scout show. Exactly one per surface, see {@link EMBED_SURFACE_SCOPE}. */
declare const EMBED_TOKEN_SCOPES: readonly ["hs:identity-editor", "hs:rate-widget"];
type EmbedTokenScope = (typeof EMBED_TOKEN_SCOPES)[number];
/** The scope Rello stamps on a token minted for each surface. */
declare const EMBED_SURFACE_SCOPE: Readonly<Record<EmbedSurface, EmbedTokenScope>>;
/** Every token is minted for Home Scout and for nothing else. */
declare const EMBED_TOKEN_AUDIENCE: "home-scout";
/** Every token Rello mints starts with this prefix. */
declare const EMBED_TOKEN_PREFIX: "rpe_";
/** Body of `POST /api/v1/embed-tokens` (PathfinderPro → Rello). Strict: the tenant comes from the key. */
declare const embedTokenMintRequestSchema: z.ZodObject<{
    agentId: z.ZodString;
    surface: z.ZodEnum<{
        identity: "identity";
        "rate-widget": "rate-widget";
    }>;
}, z.core.$strict>;
type EmbedTokenMintRequest = z.infer<typeof embedTokenMintRequestSchema>;
/**
 * 201 of the mint. `token` is opaque: a consumer passes it on and never reads
 * meaning into it beyond the `rpe_` prefix. `scope` is
 * `EMBED_SURFACE_SCOPE[request.surface]`.
 */
declare const embedTokenMintResponseSchema: z.ZodObject<{
    token: z.ZodString;
    expiresAt: z.ZodISODateTime;
    audience: z.ZodLiteral<"home-scout">;
    scope: z.ZodEnum<{
        "hs:identity-editor": "hs:identity-editor";
        "hs:rate-widget": "hs:rate-widget";
    }>;
    tenantId: z.ZodString;
    agentId: z.ZodString;
}, z.core.$strict>;
type EmbedTokenMintResponse = z.infer<typeof embedTokenMintResponseSchema>;
/** Body of `POST /api/v1/embed-tokens/verify` (Home Scout → Rello). */
declare const embedTokenVerifyRequestSchema: z.ZodObject<{
    token: z.ZodString;
}, z.core.$strict>;
type EmbedTokenVerifyRequest = z.infer<typeof embedTokenVerifyRequestSchema>;
/** Why Rello says a token is not valid. Each one is a definite answer from Rello. */
declare const EMBED_TOKEN_INVALID_REASONS: readonly ["expired", "revoked", "unknown_token"];
type EmbedTokenInvalidReason = (typeof EMBED_TOKEN_INVALID_REASONS)[number];
declare const embedTokenVerifyValidSchema: z.ZodObject<{
    valid: z.ZodLiteral<true>;
    tenantId: z.ZodString;
    agentId: z.ZodString;
    scope: z.ZodEnum<{
        "hs:identity-editor": "hs:identity-editor";
        "hs:rate-widget": "hs:rate-widget";
    }>;
    expiresAt: z.ZodISODateTime;
}, z.core.$strict>;
type EmbedTokenVerifyValid = z.infer<typeof embedTokenVerifyValidSchema>;
declare const embedTokenVerifyInvalidSchema: z.ZodObject<{
    valid: z.ZodLiteral<false>;
    reason: z.ZodEnum<{
        expired: "expired";
        revoked: "revoked";
        unknown_token: "unknown_token";
    }>;
}, z.core.$strict>;
type EmbedTokenVerifyInvalid = z.infer<typeof embedTokenVerifyInvalidSchema>;
/**
 * 200 of the verify, a union on `valid`.
 *
 * ⚑ UNKNOWN IS NOT INVALID. Rello answers 503 `embed_token_unavailable` (no body
 * schema) when it cannot tell. A consumer MUST treat a 503, a timeout, a network
 * error, any other non-200, or a 200 body this schema refuses as UNKNOWN: never
 * as `valid: false` (that would tell the MLO a good token was revoked) and never
 * as valid. Only a body this schema accepts is a verdict.
 */
declare const embedTokenVerifyResponseSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    valid: z.ZodLiteral<true>;
    tenantId: z.ZodString;
    agentId: z.ZodString;
    scope: z.ZodEnum<{
        "hs:identity-editor": "hs:identity-editor";
        "hs:rate-widget": "hs:rate-widget";
    }>;
    expiresAt: z.ZodISODateTime;
}, z.core.$strict>, z.ZodObject<{
    valid: z.ZodLiteral<false>;
    reason: z.ZodEnum<{
        expired: "expired";
        revoked: "revoked";
        unknown_token: "unknown_token";
    }>;
}, z.core.$strict>], "valid">;
type EmbedTokenVerifyResponse = z.infer<typeof embedTokenVerifyResponseSchema>;
/**
 * 200 of `GET /api/v1/platform/tenant-app-access?tenantId=` (Home Scout → Rello):
 * whether PathfinderPro may act for this tenant. A 503
 * `tenant_app_access_unavailable` is UNKNOWN, never `servable: false`.
 */
declare const tenantAppAccessResponseSchema: z.ZodObject<{
    tenantId: z.ZodString;
    servable: z.ZodBoolean;
}, z.core.$strict>;
type TenantAppAccessResponse = z.infer<typeof tenantAppAccessResponseSchema>;
/**
 * The `error` codes these routes answer in a `{ error: <code> }` body (beside
 * the shared v1 auth refusals, below). Statuses in {@link EMBED_TOKEN_ERROR_STATUS}.
 *
 *  400 UNKNOWN_FIELD                  a body (or F2 query) key the route does not
 *                                     take; the body also carries `field`, the key
 *                                     ({ error: "UNKNOWN_FIELD", field: "tenantId" })
 *  400 invalid_body                   a body that is not JSON, not an object, or has
 *                                     a bad value; the body also carries `message`
 *                                     ({ error: "invalid_body", message: "..." })
 *  404 agent_not_in_tenant            the mint's agentId is not this tenant's
 *  409 agent_inactive                 the agent exists but is not active
 *  409 home_scout_not_enabled         the tenant has no Home Scout
 *  409 tenant_not_servable            PathfinderPro may not act for this tenant
 *  503 embed_token_unavailable        mint or verify could not tell: UNKNOWN
 *  503 tenant_app_access_unavailable  F2 could not tell: UNKNOWN (a failed ApiKey
 *                                     read in the auth chain answers these 503s too)
 *
 * NOT in this map — the shared v1 auth refusals, answered before the route
 * reads anything (every one with Cache-Control: no-store):
 *  401 { error: "Unauthorized" }                     no valid ApiKey
 *  403 { error: "Forbidden" }                        the key lacks the route's permission
 *  403 { error: "Forbidden — caller app not allowed" }
 *                                                    mint: not pathfinder-pro;
 *                                                    verify / F2: not home-scout
 *  403 { error: "Forbidden — tenant header does not match credential" }
 *  403 { error: "Forbidden — app 'pathfinder-pro' is not enabled for tenant" }
 *                                                    mint only (the tenant binding)
 *  429 per-app rate limit, with Retry-After          mint only (requireV1Auth)
 */
declare const EMBED_TOKEN_ERRORS: Readonly<{
    readonly UNKNOWN_FIELD: "UNKNOWN_FIELD";
    readonly INVALID_BODY: "invalid_body";
    readonly AGENT_NOT_IN_TENANT: "agent_not_in_tenant";
    readonly AGENT_INACTIVE: "agent_inactive";
    readonly HOME_SCOUT_NOT_ENABLED: "home_scout_not_enabled";
    readonly TENANT_NOT_SERVABLE: "tenant_not_servable";
    readonly EMBED_TOKEN_UNAVAILABLE: "embed_token_unavailable";
    readonly TENANT_APP_ACCESS_UNAVAILABLE: "tenant_app_access_unavailable";
}>;
type EmbedTokenErrorCode = (typeof EMBED_TOKEN_ERRORS)[keyof typeof EMBED_TOKEN_ERRORS];
/** The HTTP status Rello answers with each {@link EMBED_TOKEN_ERRORS} code. */
declare const EMBED_TOKEN_ERROR_STATUS: Readonly<Record<EmbedTokenErrorCode, 400 | 404 | 409 | 503>>;
/** Home Scout asks the PFP host for a fresh token before the current one expires. */
declare const EMBED_TOKEN_REFRESH_MESSAGE: "pfp-embed:token-refresh";
/** The PFP host hands Home Scout a freshly minted token. */
declare const EMBED_TOKEN_MESSAGE: "pfp-embed:token";
/** The existing PFP message: the embedded session has expired. */
declare const EMBED_SESSION_EXPIRED_MESSAGE: "pfp-embed:session-expired";

/**
 * implicit-apikey-telemetry — make the implicit-RELLO_API_KEY fallback COUNTABLE.
 *
 * WHY A WARNING ALONE IS NOT ENOUGH
 * --------------------------------
 * A `console.warn` in a Trigger.dev worker goes somewhere nobody reads. This
 * platform has been bitten by exactly that shape more than once — a mechanism
 * that reports honestly and hands off to nothing. "The fallback fired" is also
 * useless across fourteen construction sites in one repo: without knowing WHICH
 * site, a shrinking list cannot shrink.
 *
 * So the fallback does three things, in increasing order of readability:
 *
 *   1. warns, with the CONSTRUCTION SITE attached (see `callerSite`);
 *   2. records the site here, so a process can be ASKED rather than tailed —
 *      `getImplicitApiKeyUses()` is exported for a health endpoint, a startup
 *      assertion, or a test;
 *   3. is counted STATICALLY by `rello-scripts check-explicit-apikey`, which is
 *      where the number that actually shrinks comes from. Construction sites are
 *      statically visible — that is how "24 of 34" was measured in the first
 *      place — so the count does not depend on anyone reading a log, or on the
 *      code path even running.
 *
 * The runtime half still earns its place: it catches a site the scanner cannot
 * see (a client built from a factory, a config object assembled at runtime), and
 * it is what makes `requireExplicitApiKey: true` actionable per-repo.
 */
/** One implicit construction, keyed by site so repeats collapse. */
interface ImplicitApiKeyUse {
    /** `file:line:col` of the construction site, or a fallback label. */
    site: string;
    /** How many times this site constructed with the implicit fallback. */
    count: number;
    /** Epoch ms of the first occurrence — useful when correlating with a deploy. */
    firstSeenAt: number;
}
/**
 * Every construction site in THIS PROCESS that used the implicit fallback.
 *
 * Process-local by design — this is not a metrics pipeline, it is a thing a
 * process can be asked. Surface it from a health endpoint or assert on it in a
 * startup test; do not expect it to survive a restart.
 */
declare function getImplicitApiKeyUses(): ImplicitApiKeyUse[];
/** Total implicit constructions in this process. Zero is the goal. */
declare function getImplicitApiKeyCount(): number;
/** Test seam. */
declare function resetImplicitApiKeyUses(): void;

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

export { ADDON_QUANTITY_ERROR_CODES, ADDON_QUANTITY_IDEMPOTENCY_ERROR_CODES, ADDON_QUANTITY_IDEMPOTENCY_HEADER, ADDON_QUANTITY_IDEMPOTENCY_KEY_LENGTH, ADD_ONS_READ_ERROR_CODES, ADD_ON_CHARGE_ONCE_ERROR_CODES, ADD_ON_CHARGE_ONCE_IDEMPOTENCY_HEADER, ADD_ON_CHARGE_ONCE_IDEMPOTENCY_HEADER_ALIAS, ADD_ON_CHARGE_ONCE_MANUAL_REASONS, ADD_ON_START_ERROR_CODES, ADD_ON_START_IDEMPOTENCY_HEADER, type AddOnChargeOnceAnswer, type AddOnChargeOnceCharged, type AddOnChargeOnceDeclined, type AddOnChargeOnceError, type AddOnChargeOnceErrorCode, type AddOnChargeOnceManual, type AddOnChargeOnceManualReason, type AddOnChargeOnceQuery, type AddOnChargeOnceRequest, type AddOnChargeOnceUnknown, type AddOnOneTimePrice, type AddOnQuantityError, type AddOnQuantityErrorCode, type AddOnQuantityIdempotencyErrorCode, type AddOnQuantityOtherError, type AddOnQuantityRequest, type AddOnQuantityResponse, type AddOnStartError, type AddOnStartErrorCode, type AddOnStartRequest, type AddOnStartResponse, type AddOnUnitPrice, type AddOnsReadError, type AddOnsReadErrorCode, type AddressNormalizeFreeFormInput, type AddressNormalizeMatchedBy, type AddressNormalizePreSplitInput, type AddressNormalizeRequest, type AddressNormalizeResponse, AdminResource, type Agent, type AgentProvisionPayload, type AlreadyMember, type AppInfo, AuthResource, type BatchTagsResult, type BillingStatus, type BusinessIndustry, type BusinessType, type CanSendInput, type CanSendResult, type ChargeConflict, type CheckoutInput, type ContextCacheResponse, type ConversionScore, type CreateActivityInput, type CreateEventInput, type CreateLeadInput, type CreateSegmentInput, EMBED_SESSION_EXPIRED_MESSAGE, EMBED_SURFACES, EMBED_SURFACE_SCOPE, EMBED_TOKEN_AUDIENCE, EMBED_TOKEN_ERRORS, EMBED_TOKEN_ERROR_STATUS, EMBED_TOKEN_INVALID_REASONS, EMBED_TOKEN_MESSAGE, EMBED_TOKEN_PREFIX, EMBED_TOKEN_REFRESH_MESSAGE, EMBED_TOKEN_SCOPES, type EffectiveSettings, type EmbedSurface, type EmbedTokenErrorCode, type EmbedTokenInvalidReason, type EmbedTokenMintRequest, type EmbedTokenMintResponse, type EmbedTokenScope, type EmbedTokenVerifyInvalid, type EmbedTokenVerifyRequest, type EmbedTokenVerifyResponse, type EmbedTokenVerifyValid, type EmitSignalBatchResult, type EmitSignalInput, type EnrollFlowInput, type EnrollJourneyInput, type Enrollment, type EntitlementResult, type EntityType, type Event, type ExtraMlosExceedQuantityError, type FeeChangedConflict, type FeeNotFound, type FeeSlugQuery, type FindByTagsInput, type FindByTagsResult, type ImplicitApiKeyUse, type InternalError, type Journey, type JourneyListParams, type Lead, type LeadShare, type LeadShareLead, type LeadShareOwner, type LeadSharesListParams, type LeadsPage, type ListLeadsParams, type LogAiUsageInput, type LogAiUsageResponse, type LoginQuantityNeeded, type LoginlessAgentCreateRequest, type LoginlessAgentCreateResponse, type LoginlessAgentRemoveRequest, type LoginlessAgentRemoveResponse, type MembersExceedQuantityError, type MembersExceedTargetError, type MiloContentInput, type MiloContentResponse, type MiloOptimizationInput, type MiloOptimizationResponse, type NurtureDecision, type NurtureDecisionParams, type OfflineInteractionResponse, type OneTimeFeeQuote, PLAN_GRANTS_READ_ERROR_CODES, PLAN_SWITCH_DEDICATED_ERROR_CODES, PLAN_SWITCH_ERROR_CODES, PLAN_SWITCH_INTERVALS, PLAN_SWITCH_KEEP_ADDONS, PLAN_TRIAL_START_ERROR_CODES, PREVIEW_STALE_REASONS, PROPERTY_AUTOFILL_FIELD_KEYS, type PlanGrantsReadError, type PlanGrantsReadErrorCode, type PlanGrantsReadResponse, type PlanSwitchAppliedResponse, type PlanSwitchError, type PlanSwitchErrorCode, type PlanSwitchInterval, type PlanSwitchKeepAddOn, type PlanSwitchOpenResponse, type PlanSwitchOperationResponse, type PlanSwitchOperationStatus, type PlanSwitchOtherError, type PlanSwitchPreviewLine, type PlanSwitchPreviewQuery, type PlanSwitchPreviewResponse, type PlanSwitchPreviewSubscription, type PlanSwitchRequest, type PlanSwitchRequestParsed, type PlanSwitchResponse, type PlanSwitchStep, type PlanSwitchStepState, type PlanTrialStartError, type PlanTrialStartErrorCode, type PlanTrialStartRequest, type PlanTrialStartResponse, type PlanTrialState, type PlatformCaller, type PlatformKeyValidator, type PlatformKeyValidatorConfig, type PreviewStaleError, type PreviewStaleReason, type PropertyAutofillAttomSummary, type PropertyAutofillFieldKey, type PropertyAutofillFieldShape, type PropertyAutofillFreeFormInput, type PropertyAutofillListing, type PropertyAutofillPreSplitInput, type PropertyAutofillPropertyStatus, type PropertyAutofillPropertyType, type PropertyAutofillRequest, type PropertyAutofillResponse, type PropertyAutofillResponseError, type PropertyAutofillResponseSuccess, type ProvisionedAgent, ROSTER_ERROR_CODES, type RecordOfflineInteractionInput, type RegistrationConflict, RelloAuthError, RelloClient, type RelloClientConfig, RelloError, RelloForbiddenError, RelloNotFoundError, type RelloPermissionSelfCheckConfig, RelloRateLimitError, RelloUnavailableError, RelloValidationError, type ReportIngestInput, type RosterError, type RosterErrorCode, type RosterErrorParsed, type Segment, type SegmentRules, type SelfCheckResult, type ServiceBearerGuardConfig, ServiceClient, type ServiceClientConfig, type SetupChargeChangedEvent, type SetupChargeEnvelope, type SetupChargeRequest, type SetupChargeStatus, type SignatureQuantityNeeded, type SmsOtpRequest, type SmsRegistrationChangedEvent, type SmsRegistrationEnvelope, type SmsRegistrationRequest, type SmsRegistrationStatus, type SwitchInProgressError, TENANT_ADD_ON_STATUSES, type Tag, type TagSearchParams, type TagsListParams, type TeamAgent, type TeamLoginRosterMember, type TeamLoginRosterQuery, type TeamLoginRosterResponse, type TeamMemberCreateRequest, type TeamMemberCreateResponse, type TeamMemberRemoveRequest, type TeamMemberRemoveResponse, type TeamMemberSignInLinkRequest, type TeamMemberSignInLinkResponse, type TeamStats, type TenantAppAccessResponse, type TenantCyrState, type TenantDisablePayload, type TenantEnablePayload, type TenantPlanGrants, type TenantProvisioningPayload, type UpdateAgentInput, type UpdateLeadInput, type UsageInput, type V1AddOnRead, type V1AddOnTenantSubscription, type V1AddOnsReadResponse, type V1TenantMatchError, V1_TENANT_MATCH_ERRORS, type ValidateSessionError, type ValidateSessionInput, type ValidateSessionResponse, type ValidatedTenant, type ValidatedUser, type ValidatorNullReason, type ValidatorNullReport, addOnChargeOnceAnswerSchema, addOnChargeOnceChargedSchema, addOnChargeOnceDeclinedSchema, addOnChargeOnceErrorSchema, addOnChargeOnceManualSchema, addOnChargeOnceQuerySchema, addOnChargeOnceRequestIdSchema, addOnChargeOnceRequestSchema, addOnChargeOnceUnknownSchema, addOnOneTimePriceSchema, addOnQuantityErrorSchema, addOnQuantityOtherErrorSchema, addOnQuantityRequestSchema, addOnQuantityResponseSchema, addOnStartErrorSchema, addOnStartRequestSchema, addOnStartResponseSchema, addOnUnitPriceSchema, addOnsReadErrorSchema, agentProvisionPayloadSchema, alreadyMemberSchema, appNotEnabledForTenantError, businessIndustry, businessType, callerHasPermission, chargeConflict, createPlatformKeyValidator, createRelloClient, createRelloPermissionSelfCheck, createServiceBearerGuard, createServiceClient, embedTokenMintRequestSchema, embedTokenMintResponseSchema, embedTokenVerifyInvalidSchema, embedTokenVerifyRequestSchema, embedTokenVerifyResponseSchema, embedTokenVerifyValidSchema, extraMlosExceedQuantityErrorSchema, feeChangedConflict, feeNotFound, feeSlugQuery, getHarvestHomeBaseUrl, getImplicitApiKeyCount, getImplicitApiKeyUses, getMiloBaseUrl, getOvenBaseUrl, getPathfinderProBaseUrl, getPropertyEngineBaseUrl, getPropertyEngineHeaders, getRelloBaseUrl, hasPropertyEngineCredentials, internalError, isExtraMlosExceedQuantityError, isMembersExceedQuantityError, isMembersExceedTargetError, isRosterErrorCode, loginQuantityNeededSchema, loginlessAgentCreateRequestSchema, loginlessAgentCreateResponseSchema, loginlessAgentRemoveRequestSchema, loginlessAgentRemoveResponseSchema, membersExceedQuantityErrorSchema, membersExceedTargetErrorSchema, oneTimeFeeQuote, parseAgentPayload, parseTenantPayload, planGrantsReadErrorSchema, planGrantsReadResponseSchema, planSwitchAppliedResponseSchema, planSwitchErrorSchema, planSwitchOpenResponseSchema, planSwitchOperationResponseSchema, planSwitchOtherErrorSchema, planSwitchPreviewLineSchema, planSwitchPreviewQuerySchema, planSwitchPreviewResponseSchema, planSwitchPreviewSubscriptionSchema, planSwitchRequestSchema, planSwitchResponseSchema, planSwitchStepSchema, planTrialStartErrorSchema, planTrialStartRequestSchema, planTrialStartResponseSchema, planTrialStateSchema, previewStaleErrorSchema, provisionedAgentSchema, quoteVersion, registrationConflict, resetImplicitApiKeyUses, rosterErrorSchema, runRelloPermissionSelfCheck, setupChargeChangedEvent, setupChargeEnvelope, setupChargeRequest, setupChargeStatus, signatureQuantityNeededSchema, smsOtpRequest, smsRegistrationChangedEvent, smsRegistrationEnvelope, smsRegistrationRequest, smsRegistrationStatus, switchInProgressErrorSchema, teamLoginRosterMemberSchema, teamLoginRosterQuerySchema, teamLoginRosterResponseSchema, teamMemberCreateRequestSchema, teamMemberCreateResponseSchema, teamMemberRemoveRequestSchema, teamMemberRemoveResponseSchema, teamMemberSignInLinkRequestSchema, teamMemberSignInLinkResponseSchema, tenantAppAccessResponseSchema, tenantCyrStateSchema, tenantDisablePayloadSchema, tenantEnablePayloadSchema, tenantPlanGrantsSchema, tenantProvisioningPayloadSchema, v1AddOnReadSchema, v1AddOnTenantSubscriptionSchema, v1AddOnsReadResponseSchema, v1TenantMatchErrorSchema };
