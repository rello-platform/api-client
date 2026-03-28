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

  async findByEmail(tenantId: string, email: string): Promise<Lead | null> {
    try {
      const res = await this.transport.get<{ leads: Lead[] } | Lead[]>(
        "/leads",
        tenantId,
        { email }
      );
      const leads = Array.isArray(res) ? res : res.leads;
      return leads.length > 0 ? leads[0] : null;
    } catch (error) {
      if (error && typeof error === "object" && "statusCode" in error && (error as { statusCode: number }).statusCode === 404) {
        return null;
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
    if (params.email) query.email = params.email;
    if (params.search) query.search = params.search;
    if (params.stage) query.stage = params.stage;
    if (params.sortBy) query.sortBy = params.sortBy;
    if (params.sortOrder) query.sortOrder = params.sortOrder;

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
    await this.transport.patch(`/leads/${id}/custom-fields`, tenantId, fields);
  }

  async getConversionScore(tenantId: string, id: string): Promise<ConversionScore> {
    return this.transport.get<ConversionScore>(
      `/leads/${id}/conversion-score`,
      tenantId
    );
  }
}
