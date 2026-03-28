import type { Transport } from "../transport.js";
import type { CanSendInput, CanSendResult } from "../types/communication.js";

export class CommunicationsResource {
  constructor(private readonly transport: Transport) {}

  async canSend(tenantId: string, input: CanSendInput): Promise<CanSendResult> {
    return this.transport.post<CanSendResult>(
      "/communications/can-send",
      tenantId,
      input
    );
  }
}
