import { AppSlug } from '@rello-platform/slugs';
import { PermissionSlug } from '@rello-platform/permissions';
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
     * returns 5xx, network error, or timeout. Past this window the validator
     * fails closed (returns null on every inbound). 4xx responses always
     * fail-closed (no stale-serve) to avoid masking credential drift.
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
declare function createPlatformKeyValidator(config: PlatformKeyValidatorConfig): (request: Request) => Promise<PlatformCaller | null>;
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
    }, z.core.$strip>>;
    creditAllocation: z.ZodOptional<z.ZodObject<{
        initialBalance: z.ZodOptional<z.ZodNumber>;
        poolSize: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
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
    }, z.core.$strip>>;
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

export { type AddressNormalizeFreeFormInput, type AddressNormalizeMatchedBy, type AddressNormalizePreSplitInput, type AddressNormalizeRequest, type AddressNormalizeResponse, AdminResource, type Agent, type AgentProvisionPayload, type AppInfo, AuthResource, type BatchTagsResult, type BillingStatus, type CanSendInput, type CanSendResult, type CheckoutInput, type ContextCacheResponse, type ConversionScore, type CreateActivityInput, type CreateEventInput, type CreateLeadInput, type CreateSegmentInput, type EffectiveSettings, type EmitSignalBatchResult, type EmitSignalInput, type EnrollFlowInput, type EnrollJourneyInput, type Enrollment, type EntitlementResult, type EntityType, type Event, type FindByTagsInput, type FindByTagsResult, type ImplicitApiKeyUse, type Journey, type JourneyListParams, type Lead, type LeadShare, type LeadShareLead, type LeadShareOwner, type LeadSharesListParams, type LeadsPage, type ListLeadsParams, type LogAiUsageInput, type LogAiUsageResponse, type MiloContentInput, type MiloContentResponse, type MiloOptimizationInput, type MiloOptimizationResponse, type NurtureDecision, type NurtureDecisionParams, type OfflineInteractionResponse, PROPERTY_AUTOFILL_FIELD_KEYS, type PlatformCaller, type PlatformKeyValidatorConfig, type PropertyAutofillAttomSummary, type PropertyAutofillFieldKey, type PropertyAutofillFieldShape, type PropertyAutofillFreeFormInput, type PropertyAutofillListing, type PropertyAutofillPreSplitInput, type PropertyAutofillPropertyStatus, type PropertyAutofillPropertyType, type PropertyAutofillRequest, type PropertyAutofillResponse, type PropertyAutofillResponseError, type PropertyAutofillResponseSuccess, type ProvisionedAgent, type RecordOfflineInteractionInput, RelloAuthError, RelloClient, type RelloClientConfig, RelloError, RelloForbiddenError, RelloNotFoundError, type RelloPermissionSelfCheckConfig, RelloRateLimitError, RelloUnavailableError, RelloValidationError, type ReportIngestInput, type Segment, type SegmentRules, type SelfCheckResult, type ServiceBearerGuardConfig, ServiceClient, type ServiceClientConfig, type Tag, type TagSearchParams, type TagsListParams, type TeamAgent, type TeamStats, type TenantDisablePayload, type TenantEnablePayload, type TenantProvisioningPayload, type UpdateAgentInput, type UpdateLeadInput, type UsageInput, type ValidateSessionError, type ValidateSessionInput, type ValidateSessionResponse, type ValidatedTenant, type ValidatedUser, agentProvisionPayloadSchema, callerHasPermission, createPlatformKeyValidator, createRelloClient, createRelloPermissionSelfCheck, createServiceBearerGuard, createServiceClient, getHarvestHomeBaseUrl, getImplicitApiKeyCount, getImplicitApiKeyUses, getMiloBaseUrl, getOvenBaseUrl, getPathfinderProBaseUrl, getPropertyEngineBaseUrl, getPropertyEngineHeaders, getRelloBaseUrl, hasPropertyEngineCredentials, parseAgentPayload, parseTenantPayload, provisionedAgentSchema, resetImplicitApiKeyUses, runRelloPermissionSelfCheck, tenantDisablePayloadSchema, tenantEnablePayloadSchema, tenantProvisioningPayloadSchema };
