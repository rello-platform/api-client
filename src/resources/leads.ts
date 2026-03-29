import type { Transport } from "../transport.js";
import type {
  Lead,
  CreateLeadInput,
  UpdateLeadInput,
  ListLeadsParams,
  ConversionScore,
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
  async findByEmail(tenantId: string, email: string): Promise<Lead | null> {
    if (!email) return null;

    try {
      const res = await this.transport.get<{ leads: Lead[] } | Lead[]>(
        "/leads",
        tenantId,
        { search: email, limit: "25" }
      );
      const leads = Array.isArray(res) ? res : res.leads;

      // The search endpoint does case-insensitive `contains` on email, firstName,
      // and lastName. Verify exact email match client-side for dedup safety.
      // Use typeof guard — JSON response may omit the key entirely (undefined at runtime).
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
    const query: Record<string, string | undefined> = {};
    if (params.limit !== undefined) query.limit = String(params.limit);
    if (params.offset !== undefined) query.offset = String(params.offset);
    if (params.page !== undefined) query.page = String(params.page);
    if (params.tags?.length) query.tags = params.tags.join(",");
    if (params.stage) query.stage = params.stage;
    if (params.sortBy) query.sortBy = params.sortBy;
    if (params.sortOrder) query.sortOrder = params.sortOrder;

    // The server accepts `search` (case-insensitive contains on email/name) but
    // NOT a standalone `email` query param. Map `email` into `search` so callers
    // using list({ email }) get filtered results instead of silent no-op.
    // Explicit `search` takes precedence if both are provided.
    if (params.search) {
      query.search = params.search;
    } else if (params.email) {
      query.search = params.email;
    }

    const res = await this.transport.get<{ leads: Lead[] } | Lead[]>(
      "/leads",
      tenantId,
      query
    );
    return Array.isArray(res) ? res : res.leads;
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
}
