import type { Transport } from "../transport.js";
import type { LogAiUsageInput, LogAiUsageResponse } from "../types/admin.js";

export class AdminResource {
  constructor(private readonly transport: Transport) {}

  /**
   * Log AI usage for cost tracking and cap enforcement.
   *
   * POST /api/admin/ai/usage-log (non-v1 route)
   *
   * Called by spoke apps (Home Stretch, Milo Engine, etc.) to record AI
   * inference calls. Rello aggregates costs and enforces daily/monthly caps.
   * Returns current cost totals and whether the cap has been exceeded.
   */
  async logAiUsage(
    tenantId: string,
    data: LogAiUsageInput
  ): Promise<LogAiUsageResponse> {
    return this.transport.postRaw<LogAiUsageResponse>(
      "/admin/ai/usage-log",
      tenantId,
      data
    );
  }
}
