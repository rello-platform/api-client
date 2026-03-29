import type { Transport } from "../transport.js";
import type { ReportIngestInput } from "../types/report.js";

export class ReportsResource {
  constructor(private readonly transport: Transport) {}

  /**
   * Ingest a report (daily stats, etc.) into Rello.
   *
   * POST /api/v1/reports/ingest
   *
   * Fire-and-forget from the caller's perspective — the report is
   * stored for dashboard display and trend analysis.
   */
  async ingest(tenantId: string, data: ReportIngestInput): Promise<void> {
    await this.transport.post("/reports/ingest", tenantId, {
      tenantId,
      ...data,
    });
  }
}
