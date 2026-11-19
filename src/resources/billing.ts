import type { Transport } from "../transport.js";
import { RelloError, RelloValidationError } from "../errors.js";
import {
  ADD_ON_CHARGE_ONCE_IDEMPOTENCY_HEADER,
  ADD_ON_CHARGE_ONCE_IDEMPOTENCY_HEADER_ALIAS,
  addOnChargeOnceAnswerSchema,
  addOnChargeOnceDeclinedSchema,
  addOnChargeOnceQuerySchema,
  addOnChargeOnceRequestIdSchema,
  addOnChargeOnceRequestSchema,
  type AddOnChargeOnceAnswer,
  type AddOnChargeOnceRequest,
} from "../types/addon-charge-once.js";
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

  /**
   * Charge ONE one-time add-on to the tenant's saved card, once per `requestId` (PFP Gateway "Match
   * my design"; contract and answers in ../types/addon-charge-once.ts).
   *
   * Resolves with the answer: `charged` (200), `manual` (200), `unknown` (202) or `declined` (402; an
   * answer, not an error). Throws on everything else: RelloError 409 (`price_changed` |
   * `add_on_not_one_time`; parse `err.body` with addOnChargeOnceErrorSchema), RelloNotFoundError 404
   * (`add_on_not_found`), RelloValidationError / RelloAuthError / RelloForbiddenError, and
   * RelloUnavailableError or RelloError 5xx when the request failed in flight.
   *
   * ⚠ A throw from a request that left the process (timeout, network, 5xx) is NOT "not charged":
   * Rello may have taken the money. Call getOneTimeAddOnCharge with the same `requestId` and never
   * charge under a new one. A 200/202/402 body this client cannot read is thrown as a RelloError
   * carrying that status, never returned as an answer.
   *
   * The same `requestId` is sent on every transport retry, so a retried POST is the same charge.
   */
  async chargeOneTimeAddOn(
    tenantId: string,
    input: AddOnChargeOnceRequest,
    requestId: string
  ): Promise<AddOnChargeOnceAnswer> {
    const path = "/billing/add-on/charge-once";
    const body = addOnChargeOnceRequestSchema.safeParse(input);
    const key = addOnChargeOnceRequestIdSchema.safeParse(requestId);
    if (!body.success || !key.success) {
      throw new RelloValidationError(path, null, {
        error: "invalid_request",
        issues: [...(body.success ? [] : body.error.issues), ...(key.success ? [] : key.error.issues)],
      });
    }
    let raw: unknown;
    try {
      raw = await this.transport.request<unknown>("POST", path, {
        tenantId,
        body: body.data,
        timeout: "write",
        headers: {
          [ADD_ON_CHARGE_ONCE_IDEMPOTENCY_HEADER]: key.data,
          [ADD_ON_CHARGE_ONCE_IDEMPOTENCY_HEADER_ALIAS]: key.data,
        },
      });
    } catch (err) {
      if (err instanceof RelloError && err.statusCode === 402) {
        const declined = addOnChargeOnceDeclinedSchema.safeParse(err.body);
        if (declined.success) return declined.data;
      }
      throw err;
    }
    return parseAnswer(raw, path, 200);
  }

  /**
   * The state of a charge by the request id it was made under. Resolves with the same answers as
   * chargeOneTimeAddOn (a 402 `declined` included). Throws RelloNotFoundError (404) when the
   * caller's tenant has no charge under that request id.
   */
  async getOneTimeAddOnCharge(tenantId: string, requestId: string): Promise<AddOnChargeOnceAnswer> {
    const path = "/billing/add-on/charge-once";
    const query = addOnChargeOnceQuerySchema.safeParse({ requestId });
    if (!query.success) {
      throw new RelloValidationError(path, null, { error: "invalid_request", issues: query.error.issues });
    }
    let raw: unknown;
    try {
      raw = await this.transport.get<unknown>(path, tenantId, { requestId: query.data.requestId });
    } catch (err) {
      if (err instanceof RelloError && err.statusCode === 402) {
        const declined = addOnChargeOnceDeclinedSchema.safeParse(err.body);
        if (declined.success) return declined.data;
      }
      throw err;
    }
    return parseAnswer(raw, path, 200);
  }
}

/** An answer body that is not one of the four is an error carrying its status: unknown, never "charged" or "declined". */
function parseAnswer(raw: unknown, path: string, status: number): AddOnChargeOnceAnswer {
  const parsed = addOnChargeOnceAnswerSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new RelloError(`Unreadable charge-once answer: ${path}`, status, path, null, raw);
}
