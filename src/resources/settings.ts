import type { Transport } from "../transport.js";
import type { EffectiveSettings } from "../types/settings.js";

export class SettingsResource {
  constructor(private readonly transport: Transport) {}

  async getEffective(
    tenantId: string,
    keys: string[]
  ): Promise<Record<string, unknown>> {
    const res = await this.transport.get<EffectiveSettings>(
      "/settings/effective",
      tenantId,
      { keys: keys.join(",") }
    );
    return res.settings;
  }
}
