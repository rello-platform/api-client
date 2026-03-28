import type { Transport } from "../transport.js";
import type { EnrollFlowInput, EnrollJourneyInput, Enrollment } from "../types/flow.js";

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
}
