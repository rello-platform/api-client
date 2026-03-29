import type { Transport } from "../transport.js";
import type { LeadShare, LeadSharesListParams } from "../types/lead-share.js";

export class LeadSharesResource {
  constructor(private readonly transport: Transport) {}

  /**
   * List lead shares for a tenant.
   *
   * GET /api/v1/lead-shares
   *
   * Supports filtering by guest MLO, permission level, and newsletter opt-in.
   * Returns shares with nested lead and sharedBy data.
   */
  async list(
    tenantId: string,
    params: LeadSharesListParams = {}
  ): Promise<{ shares: LeadShare[]; total: number }> {
    const query: Record<string, string | undefined> = {};
    if (params.guestMLOId) query.guestMLOId = params.guestMLOId;
    if (params.permission) query.permission = params.permission;
    if (params.allowMLONewsletters !== undefined) {
      query.allowMLONewsletters = String(params.allowMLONewsletters);
    }
    if (params.includeRevoked) query.includeRevoked = "true";
    if (params.limit !== undefined) query.limit = String(params.limit);
    if (params.offset !== undefined) query.offset = String(params.offset);

    const res = await this.transport.get<{
      success: boolean;
      data: { shares: LeadShare[]; total: number };
    }>("/lead-shares", tenantId, query);
    return res.data;
  }
}
