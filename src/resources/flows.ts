import type { Transport } from "../transport.js";
import type {
  EnrollFlowInput,
  EnrollJourneyInput,
  Enrollment,
  Journey,
  JourneyListParams,
} from "../types/flow.js";

export class FlowsResource {
  constructor(private readonly transport: Transport) {}

  async enroll(
    tenantId: string,
    leadId: string,
    flowSlug: string,
    context?: Record<string, unknown>
  ): Promise<Enrollment> {
    const input: EnrollFlowInput = { leadId, flowSlug, context };
    const res = await this.transport.post<{ enrollment: Enrollment }>(
      "/flows/enroll",
      tenantId,
      input
    );
    return res.enrollment;
  }
}

export class JourneysResource {
  constructor(private readonly transport: Transport) {}

  /**
   * List available journeys for a tenant.
   *
   * GET /api/v1/journeys
   *
   * For API key callers, returns JourneyTemplate objects (platform-wide templates
   * available to the tenant). For session callers, returns tenant-specific journeys.
   */
  async list(tenantId: string, params: JourneyListParams = {}): Promise<Journey[]> {
    const query: Record<string, string | undefined> = {};
    if (params.isActive !== undefined) query.isActive = String(params.isActive);
    if (params.includeArchived) query.includeArchived = "true";
    if (params.search) query.search = params.search;

    const res = await this.transport.get<{ journeys: Journey[] } | Journey[]>(
      "/journeys",
      tenantId,
      query
    );
    return Array.isArray(res) ? res : res.journeys;
  }

  /**
   * Enroll a lead into a journey by slug.
   *
   * POST /api/v1/journeys/enroll
   *
   * The server resolves the slug to the tenant's journey instance
   * (or a cloned platform template).
   */
  async enroll(
    tenantId: string,
    leadId: string,
    journeySlug: string,
    context?: Record<string, unknown>,
    goalContext?: EnrollJourneyInput["goalContext"]
  ): Promise<Enrollment> {
    const input: EnrollJourneyInput = { leadId, journeySlug, context, goalContext };
    const res = await this.transport.post<{ enrollment: Enrollment }>(
      "/journeys/enroll",
      tenantId,
      input
    );
    return res.enrollment;
  }

  /**
   * Enroll a lead into a journey by database ID.
   *
   * POST /api/v1/journeys/enroll
   *
   * Use this when you have the journey's database ID (e.g., from a previous
   * journeys.list() call). The server verifies the journey belongs to the
   * tenant and is active.
   */
  async enrollById(
    tenantId: string,
    leadId: string,
    journeyId: string,
    context?: Record<string, unknown>,
  ): Promise<Enrollment> {
    const res = await this.transport.post<{ enrollment: Enrollment }>(
      "/journeys/enroll",
      tenantId,
      { leadId, journeyId, context }
    );
    return res.enrollment;
  }
}
