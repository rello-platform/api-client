import type { Transport } from "../transport.js";
import type {
  MiloOptimizationInput,
  MiloOptimizationResponse,
  MiloContentInput,
  MiloContentResponse,
} from "../types/milo.js";

export class MiloResource {
  constructor(private readonly transport: Transport) {}

  /**
   * Get AI optimization suggestions for a newsletter.
   *
   * POST /api/v1/milo/optimize-newsletter
   *
   * Returns subject line suggestions, optimal send time,
   * content recommendations, and estimated open rate.
   */
  async optimizeNewsletter(
    tenantId: string,
    data: MiloOptimizationInput
  ): Promise<MiloOptimizationResponse> {
    return this.transport.post<MiloOptimizationResponse>(
      "/milo/optimize-newsletter",
      tenantId,
      data,
      "long"
    );
  }

  /**
   * Get AI content selection for per-lead newsletter personalization.
   *
   * POST /api/v1/milo/select-content
   *
   * Given a lead and a set of available articles, returns which articles
   * are most relevant to the lead along with reasoning.
   */
  async selectContent(
    tenantId: string,
    data: MiloContentInput
  ): Promise<MiloContentResponse> {
    return this.transport.post<MiloContentResponse>(
      "/milo/select-content",
      tenantId,
      data,
      "long"
    );
  }
}
