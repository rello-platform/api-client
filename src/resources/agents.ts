import type { Transport } from "../transport.js";
import type { UpdateAgentInput, Agent } from "../types/agent.js";

export class AgentsResource {
  constructor(private readonly transport: Transport) {}

  /**
   * Update an agent's profile in Rello.
   *
   * PATCH /api/v1/agents/:agentId
   *
   * Used by spoke apps to push local profile changes back to the hub
   * (e.g., Newsletter Studio syncing agent bios, Home Scout syncing photos).
   */
  async update(tenantId: string, agentId: string, data: UpdateAgentInput): Promise<Agent> {
    const res = await this.transport.patch<{ success: boolean; data: Agent }>(
      `/agents/${agentId}`,
      tenantId,
      data
    );
    return res.data;
  }
}
