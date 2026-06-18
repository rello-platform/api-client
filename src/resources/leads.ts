import type { Transport } from "../transport.js";
import type {
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
  ClosedLoan,
} from "../types/lead.js";

/**
 * Unwraps Rello's canonical `ok()` envelope `{ success, data, meta }` to the
 * bare `data` payload. Falls back to the raw response for legacy un-enveloped
 * Rello deployments (and for routes not yet migrated to the envelope).
 *
 * The transport (`transport.ts`) returns `res.json()` directly with NO central
 * envelope unwrap, so each enveloped resource method must unwrap itself. Do NOT
 * move this into `transport.request` — some methods (e.g. `getBatchTags`) read
 * `res.data` from a route whose own payload is `{ data }`, and a transport-level
 * unwrap would double-unwrap them.
 */
function unwrapData<T>(res: unknown): T {
  return res && typeof res === "object" && "success" in res && "data" in res
    ? (res as { data: T }).data
    : (res as T);
}

/**
 * Unwraps a `Lead` from Rello's `ok()` envelope. After unwrapping the envelope,
 * `data` may be the lead directly (`GET`/`PATCH /leads/[id]` → `ok(lead)`) or
 * `{ lead, ... }` (`POST /leads` → `ok<LeadCreateResponse>({ lead, duplicates? })`).
 * Falls back to legacy un-enveloped `{ lead }` / bare-lead shapes for old Rello
 * deployments.
 */
function unwrapLead(res: unknown): Lead {
  const payload = unwrapData<unknown>(res);
  return payload && typeof payload === "object" && "lead" in payload
    ? (payload as { lead: Lead }).lead
    : (payload as Lead);
}

export class LeadsResource {
  constructor(private readonly transport: Transport) {}

  async create(tenantId: string, data: CreateLeadInput): Promise<Lead> {
    const res = await this.transport.post<unknown>("/leads", tenantId, data);
    return unwrapLead(res);
  }

  async get(tenantId: string, id: string): Promise<Lead> {
    const res = await this.transport.get<unknown>(`/leads/${id}`, tenantId);
    return unwrapLead(res);
  }

  async update(tenantId: string, id: string, data: UpdateLeadInput): Promise<Lead> {
    const res = await this.transport.patch<unknown>(`/leads/${id}`, tenantId, data);
    return unwrapLead(res);
  }

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
  async findByEmail(tenantId: string, email: string): Promise<Lead | null> {
    if (!email) return null;

    try {
      const res = await this.transport.get<{ data?: Lead[]; leads?: Lead[] } | Lead[]>(
        "/leads",
        tenantId,
        { email, search: email, limit: "25" }
      );
      // Canonical Rello returns `{ success, data, meta }` (lead array under
      // `data`); legacy/array shapes are handled by the fallbacks. This dedup
      // read feeds createOrFind — a correct read restores email dedup
      // platform-wide.
      const leads = Array.isArray(res) ? res : (res.data ?? res.leads ?? []);

      // Defensive client-side exact-match filter. On a new Rello this is a
      // no-op (server already returned 0 or 1). On an old Rello this is the
      // primary correctness check — the legacy `search` param returns up to
      // 25 fuzzy matches and we need the exact one. Also covers the edge
      // case where @@unique([tenantId, email]) — case-sensitive in Postgres
      // — allows two emails differing only in case to coexist; in that case
      // the server's case-insensitive ILIKE match could return both rows
      // and we take the first.
      const normalizedEmail = email.toLowerCase().trim();
      return leads.find(
        (l) => typeof l.email === "string" && l.email.toLowerCase().trim() === normalizedEmail
      ) ?? null;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "statusCode" in error &&
        (error as { statusCode: number }).statusCode === 404
      ) {
        return null;
      }
      throw error;
    }
  }

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
  async createOrFind(
    tenantId: string,
    data: CreateLeadInput,
  ): Promise<{ lead: Lead; created: boolean }> {
    if (data.email) {
      const existing = await this.findByEmail(tenantId, data.email);
      if (existing) {
        return { lead: existing, created: false };
      }
    }

    try {
      const lead = await this.create(tenantId, data);
      return { lead, created: true };
    } catch (error) {
      // TOCTOU race: another process created this lead between our find and create.
      // Rello may return 409 Conflict or 400 for duplicate email.
      // Retry findByEmail once before giving up.
      if (
        data.email &&
        error &&
        typeof error === "object" &&
        "statusCode" in error
      ) {
        const code = (error as { statusCode: number }).statusCode;
        if (code === 409 || code === 400) {
          const retryFind = await this.findByEmail(tenantId, data.email);
          if (retryFind) {
            return { lead: retryFind, created: false };
          }
        }
      }
      throw error;
    }
  }

  async list(tenantId: string, params: ListLeadsParams = {}): Promise<Lead[]> {
    const res = await this.listWithPagination(tenantId, params);
    return res.leads;
  }

  /**
   * List leads with the full pagination envelope.
   *
   * GET /api/v1/leads
   *
   * Unlike list() which returns Lead[], this preserves { leads, total, page, totalPages }
   * for callers that need pagination metadata (e.g., Newsletter Studio's lead browser).
   */
  async listWithPagination(tenantId: string, params: ListLeadsParams = {}): Promise<LeadsPage> {
    const query: Record<string, string | undefined> = {};
    if (params.limit !== undefined) query.limit = String(params.limit);
    if (params.offset !== undefined) query.offset = String(params.offset);
    if (params.page !== undefined) query.page = String(params.page);
    if (params.tags?.length) query.tags = params.tags.join(",");
    if (params.stage) query.stage = params.stage;
    if (params.sortBy) query.sortBy = params.sortBy;
    if (params.sortOrder) query.sortOrder = params.sortOrder;
    // Owner filter → server-canonical `?ownerId=` (Rello `getLeads` filters on
    // `Lead.ownerId`). `ownerId` is the preferred param; `agentId` is a
    // deprecated alias forwarded to the SAME server param — earlier SDK
    // versions forwarded it as `?agentId=`, which the server silently ignored
    // (a no-op no caller can rely on), so repairing it to `?ownerId=` here is
    // back-compat-safe. `ownerId` wins when both are supplied.
    const ownerFilter = params.ownerId ?? params.agentId;
    if (ownerFilter) query.ownerId = ownerFilter;
    // Originating-app filter → server-canonical `?source=` (exact match on
    // `Lead.source`). Lets a consumer fetch only the leads its own app
    // originated (e.g. `source: "pathfinder-pro"`).
    if (params.source) query.source = params.source;

    // `email` and `search` are now independent server params:
    //   email  → exact case-insensitive match (returns 0 or 1 lead)
    //   search → fuzzy contains match across firstName/lastName/email
    // Both can be passed together; the server AND's them.
    //
    // Backwards compat: when the caller passes only `email` (no explicit
    // `search`), we ALSO send the email as `search`. New Rello applies the
    // exact email filter and ignores the redundant search clause; old Rello
    // (pre Spoke App Integration Standard) silently strips the unknown
    // `email` param and falls back to the search filter — preserving the
    // legacy behavior of `list({ email })` returning matching leads instead
    // of an unfiltered list. Once every Rello deployment has shipped the
    // new query param, the email-as-search fallback can be removed.
    //
    // If the caller passes an explicit `search`, that wins — we never
    // override their intent.
    //
    // Behavior change for callers: `list({ email: "fra" })` previously did
    // a substring match against "francisco@..."; on a new Rello it now does
    // an exact-match lookup that returns nothing for partial input. Callers
    // wanting fuzzy behavior should pass `search`, not `email`.
    if (params.email) query.email = params.email;
    if (params.search) {
      query.search = params.search;
    } else if (params.email) {
      query.search = params.email;
    }

    // Rello's GET /api/leads returns the canonical envelope
    // `ok<T>(result.leads, { meta })` = `{ success, data, meta }`, where the
    // lead array is `data` and pagination lives under
    // `meta.{total,page,totalPages,pageSize}` (Rello src/lib/api-envelope.ts +
    // src/app/api/leads/route.ts). The transport returns the full envelope
    // (other resource methods read `res.data`). Older un-enveloped Rello
    // deployments returned `{ leads, total, page, totalPages }` at the top
    // level — the `??` fallbacks preserve compatibility with both shapes.
    const res = await this.transport.get<{
      data?: Lead[];
      meta?: { total?: number; page?: number; totalPages?: number; pageSize?: number };
      leads?: Lead[];
      total?: number;
      page?: number;
      totalPages?: number;
    }>("/leads", tenantId, query);
    const leads = res.data ?? res.leads ?? [];
    return {
      leads,
      total: res.meta?.total ?? res.total ?? leads.length,
      page: res.meta?.page ?? res.page ?? 1,
      totalPages: res.meta?.totalPages ?? res.totalPages ?? 1,
    };
  }

  async applyTags(tenantId: string, id: string, tags: string[]): Promise<void> {
    await this.transport.post(`/leads/${id}/tags`, tenantId, { tags });
  }

  async setCustomFields(
    tenantId: string,
    id: string,
    fields: Record<string, unknown>
  ): Promise<void> {
    // Rello's endpoint expects { customFields: {...} } — the fields must be
    // wrapped in a customFields envelope for the server-side merge to work.
    await this.transport.patch(`/leads/${id}/custom-fields`, tenantId, { customFields: fields });
  }

  async getConversionScore(tenantId: string, id: string): Promise<ConversionScore> {
    // Rello returns `ok<LeadConversionScoreResponse>({ score })` — unwrap the
    // envelope to the bare payload. Legacy un-enveloped deployments returned the
    // payload directly, which `unwrapData` passes through unchanged.
    const res = await this.transport.get<unknown>(
      `/leads/${id}/conversion-score`,
      tenantId
    );
    return unwrapData<ConversionScore>(res);
  }

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
  async getClosedLoans(tenantId: string, id: string): Promise<ClosedLoan[] | null> {
    // Rello returns `ok<ClosedLoansResponse>({ closedLoans })` via the `/api`
    // (non-v1) route — unwrap the envelope, then read `closedLoans`. Legacy
    // un-enveloped deployments returned `{ closedLoans }` at the top level,
    // which `unwrapData` passes through unchanged.
    const res = await this.transport.getRaw<unknown>(
      `/leads/${id}/closed-loans`,
      tenantId
    );
    const payload = unwrapData<{ closedLoans?: ClosedLoan[] | null }>(res);
    return payload?.closedLoans ?? null;
  }

  /**
   * Remove tags from a lead by tag name.
   *
   * DELETE /api/v1/leads/:id/tags
   *
   * Sends tag names in the request body. The v1 handler resolves names to IDs
   * and removes each matching tag from the lead.
   */
  async removeTags(tenantId: string, id: string, tags: string[]): Promise<void> {
    await this.transport.request("DELETE", `/leads/${id}/tags`, {
      tenantId,
      body: { tags },
      timeout: "write",
    });
  }

  /**
   * Fetch recent Milo nurture decisions for a lead.
   *
   * GET /api/v1/leads/:id/nurture-decisions
   *
   * Used by Newsletter Studio's editorial pass (C3) to provide decision history
   * context to Milo when generating personalized content.
   * Returns empty array on 404 (lead has no decisions yet).
   */
  async getNurtureDecisions(
    tenantId: string,
    id: string,
    params: NurtureDecisionParams = {}
  ): Promise<NurtureDecision[]> {
    const query: Record<string, string | undefined> = {};
    if (params.limit !== undefined) query.limit = String(params.limit);
    if (params.action) query.action = params.action;

    // Rello returns `ok<NurtureDecisionsResponse>(decisions, { meta })` where
    // the decisions array is the envelope `data`. Legacy un-enveloped
    // deployments returned `{ decisions }` at the top level — handle both.
    const res = await this.transport.get<unknown>(
      `/leads/${id}/nurture-decisions`,
      tenantId,
      query
    );
    const payload = unwrapData<NurtureDecision[] | { decisions?: NurtureDecision[] }>(res);
    return Array.isArray(payload) ? payload : (payload?.decisions ?? []);
  }

  /**
   * Query leads by tag combinations (AND/OR with optional exclusions).
   *
   * POST /api/v1/leads/by-tags
   *
   * Used for audience segmentation in Newsletter Studio's smart content matching.
   */
  async findByTags(tenantId: string, input: FindByTagsInput): Promise<FindByTagsResult> {
    // Rello returns `ok<LeadsByTagsResponse>(leads, { meta: { total } })` — the
    // lead array is the envelope `data`, total lives under `meta`. Legacy
    // un-enveloped deployments returned `{ leads, total }` at the top level.
    const res = await this.transport.post<unknown>(
      "/leads/by-tags",
      tenantId,
      input
    );
    if (res && typeof res === "object" && "success" in res && "data" in res) {
      const env = res as { data?: Lead[]; meta?: { total?: number } };
      const leads = env.data ?? [];
      return { leads, total: env.meta?.total ?? leads.length };
    }
    const legacy = (res ?? {}) as FindByTagsResult;
    return { leads: legacy.leads ?? [], total: legacy.total ?? legacy.leads?.length ?? 0 };
  }

  /**
   * Fetch tags for multiple leads in a single call.
   *
   * PUT /api/v1/leads/batch/tags
   *
   * Returns a map of leadId → Tag[] for all found leads.
   * Leads not found are silently omitted from the result.
   * Uses PUT (not GET) because the leadIds array can exceed URL length limits.
   */
  async getBatchTags(tenantId: string, leadIds: string[]): Promise<BatchTagsResult> {
    const res = await this.transport.request<{
      success: boolean;
      data: BatchTagsResult;
    }>("PUT", "/leads/batch/tags", {
      tenantId,
      body: { leadIds },
      timeout: "read",
    });
    return res.data;
  }

  /**
   * Get the pre-computed context cache narrative for a lead.
   *
   * GET /api/leads/[id]/context-cache (non-v1 route)
   *
   * Returns the Haiku-polished narrative, emotional state, data source counts,
   * and freshness info. Used by the LeadStoryCard on the lead detail Overview tab.
   */
  async getContextCache(tenantId: string, leadId: string): Promise<ContextCacheResponse> {
    // Rello returns `ok<LeadContextCacheGetResponse>({ exists, leadId, ... })`
    // via the `/api` (non-v1) route — unwrap the envelope to the bare payload.
    // Legacy un-enveloped deployments returned the payload directly.
    const res = await this.transport.getRaw<unknown>(`/leads/${leadId}/context-cache`, tenantId);
    return unwrapData<ContextCacheResponse>(res);
  }

  /**
   * Record an offline interaction for a lead.
   *
   * POST /api/v1/leads/:id/offline-interactions
   *
   * Used by spoke apps to record phone calls, meetings, showings, open house
   * interactions, and notes that occurred outside the platform.
   */
  async recordOfflineInteraction(
    tenantId: string,
    leadId: string,
    data: RecordOfflineInteractionInput
  ): Promise<OfflineInteractionResponse> {
    return this.transport.post<OfflineInteractionResponse>(
      `/leads/${leadId}/offline-interactions`,
      tenantId,
      data
    );
  }
}
