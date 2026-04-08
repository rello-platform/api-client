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
} from "../types/lead.js";

export class LeadsResource {
  constructor(private readonly transport: Transport) {}

  async create(tenantId: string, data: CreateLeadInput): Promise<Lead> {
    const res = await this.transport.post<{ lead: Lead } | Lead>(
      "/leads",
      tenantId,
      data
    );
    return "lead" in res ? res.lead : res;
  }

  async get(tenantId: string, id: string): Promise<Lead> {
    return this.transport.get<Lead>(`/leads/${id}`, tenantId);
  }

  async update(tenantId: string, id: string, data: UpdateLeadInput): Promise<Lead> {
    const res = await this.transport.patch<{ lead: Lead } | Lead>(
      `/leads/${id}`,
      tenantId,
      data
    );
    return "lead" in res ? res.lead : res;
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
      const res = await this.transport.get<{ leads: Lead[] } | Lead[]>(
        "/leads",
        tenantId,
        { email, search: email, limit: "25" }
      );
      const leads = Array.isArray(res) ? res : res.leads;

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
    if (params.agentId) query.agentId = params.agentId;

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

    const res = await this.transport.get<{ leads: Lead[]; total: number; page: number; totalPages: number }>(
      "/leads",
      tenantId,
      query
    );
    return {
      leads: res.leads,
      total: res.total,
      page: res.page,
      totalPages: res.totalPages,
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
    return this.transport.get<ConversionScore>(
      `/leads/${id}/conversion-score`,
      tenantId
    );
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

    const res = await this.transport.get<{
      decisions: NurtureDecision[];
      pagination?: unknown;
    }>(`/leads/${id}/nurture-decisions`, tenantId, query);
    return res.decisions;
  }

  /**
   * Query leads by tag combinations (AND/OR with optional exclusions).
   *
   * POST /api/v1/leads/by-tags
   *
   * Used for audience segmentation in Newsletter Studio's smart content matching.
   */
  async findByTags(tenantId: string, input: FindByTagsInput): Promise<FindByTagsResult> {
    return this.transport.post<FindByTagsResult>(
      "/leads/by-tags",
      tenantId,
      input
    );
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
}
