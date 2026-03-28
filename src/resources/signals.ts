import type { Transport } from "../transport.js";
import type { EmitSignalInput } from "../types/signal.js";

export class SignalsResource {
  constructor(private readonly transport: Transport) {}

  async emit(tenantId: string, signal: EmitSignalInput): Promise<void> {
    await this.transport.post("/signals", tenantId, signal);
  }

  async emitBatch(tenantId: string, signals: EmitSignalInput[]): Promise<void> {
    await this.transport.post("/signals", tenantId, { signals });
  }
}
