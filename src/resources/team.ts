import type { Transport } from "../transport.js";
import type { TeamAgent, TeamStats } from "../types/team.js";

export class TeamResource {
  constructor(private readonly transport: Transport) {}

  /**
   * List all agents in the tenant's team.
   *
   * GET /api/v1/team/agents
   */
  async listAgents(tenantId: string): Promise<TeamAgent[]> {
    const res = await this.transport.get<{
      success: boolean;
      data: { agents: TeamAgent[] };
    }>("/team/agents", tenantId);
    return res.data.agents;
  }

  /**
   * Get a single team agent by ID.
   *
   * GET /api/v1/team/agents/:agentId
   */
  async getAgent(tenantId: string, agentId: string): Promise<TeamAgent> {
    const res = await this.transport.get<{
      success: boolean;
      data: TeamAgent;
    }>(`/team/agents/${agentId}`, tenantId);
    return res.data;
  }

  /**
   * Get aggregated team statistics.
   *
   * GET /api/v1/team/stats
   */
  async getStats(tenantId: string): Promise<TeamStats> {
    const res = await this.transport.get<{
      success: boolean;
      data: TeamStats;
    }>("/team/stats", tenantId);
    return res.data;
  }
}
