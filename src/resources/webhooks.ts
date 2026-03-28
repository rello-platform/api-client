import type { Transport } from "../transport.js";

export class WebhooksResource {
  constructor(private readonly transport: Transport) {}

  async documentUpload(
    tenantId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.transport.post(
      "/webhooks/document-upload",
      tenantId,
      payload,
      "long"
    );
  }
}
