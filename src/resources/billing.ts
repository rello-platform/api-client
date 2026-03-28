import type { Transport } from "../transport.js";
import type {
  CheckoutInput,
  UsageInput,
  BillingStatus,
  EntitlementResult,
} from "../types/billing.js";

export class BillingResource {
  constructor(private readonly transport: Transport) {}

  async createCheckout(tenantId: string, input: CheckoutInput): Promise<{ url: string }> {
    return this.transport.post<{ url: string }>(
      "/billing/checkout",
      tenantId,
      input
    );
  }

  async getStatus(tenantId: string): Promise<BillingStatus> {
    return this.transport.get<BillingStatus>("/billing/status", tenantId);
  }

  async reportUsage(
    tenantId: string,
    metric: string,
    quantity: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const input: UsageInput & { tenantId: string } = {
      metric,
      quantity,
      metadata,
      tenantId,
    };
    await this.transport.post("/billing/usage", tenantId, input);
  }

  async checkEntitlement(
    tenantId: string,
    appSlug: string
  ): Promise<EntitlementResult> {
    return this.transport.get<EntitlementResult>(
      "/entitlements/check",
      tenantId,
      { app: appSlug }
    );
  }
}
