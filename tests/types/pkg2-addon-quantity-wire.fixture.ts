// Type fixture for tests/pkg2-addon-quantity-wire-1202.test.mjs (v2.36.0, GD-1971..1973).
// Compiled with the TypeScript API against the BUILT dist/index.d.ts, exactly as a
// consumer sees it. Every literal below is an answer R1's PATCH route actually
// gives (#2381 @ 8afad20dc5: src/app/api/v1/billing/add-on/[addOnId]/route.ts,
// src/lib/billing/v1/idempotency-header.ts, src/lib/auth/v1-service.ts,
// src/lib/billing/v1/tenant-app-guard.ts, src/lib/billing/cyr-addon-quantity.ts).
import type { AddOnQuantityError, AddOnQuantityResponse } from "../../dist/index.js";
import { ADDON_QUANTITY_IDEMPOTENCY_HEADER, isExtraMlosExceedQuantityError, isMembersExceedQuantityError } from "../../dist/index.js";

// GD-1971: R1's success data has no status and no subscriptionCanceled (route.ts:136-142).
export const r1Success: AddOnQuantityResponse = { tenantAddOnId: "ta_1", quantity: 2, quantityRev: "3", billedQuantity: 1, superseded: false };
export const x1Success: AddOnQuantityResponse = { ...r1Success, status: "ACTIVE", subscriptionCanceled: false };

// GD-1972: the header R1 reads.
export const header: "X-Idempotency-Key" = ADDON_QUANTITY_IDEMPOTENCY_HEADER;

// GD-1973: every refusal the route gives is an AddOnQuantityError.
export const answers: AddOnQuantityError[] = [
  { success: false, error: "Invalid request — quantity (whole number ≥ 0) and quantityRev are required" }, // 400, no code
  { success: false, error: "Add-on not found" }, // 404, no code
  { success: false, error: "Forbidden — this add-on belongs to another app" }, // 403, no code
  { success: false, error: "Billing service not configured" }, // 503
  { success: false, error: "Failed to change the add-on quantity" }, // 500
  { error: "Unauthorized" }, // 401 from requireV1Auth: no success key
  { error: "Forbidden — app 'x' is not enabled for tenant" }, // 403 tenant-app guard
  { success: false, error: "X-Idempotency-Key header is required", code: "IDEMPOTENCY_KEY_REQUIRED" },
  { success: false, error: "X-Idempotency-Key must be 8–128 characters", code: "IDEMPOTENCY_KEY_INVALID" },
  { success: false, error: "X-Idempotency-Key is already bound to a request from a different tenant — send a new key for this request", code: "IDEMPOTENCY_KEY_CONFLICT" },
  { success: false, error: "A newer quantity was already sent. (queued)", code: "stale_quantity_rev", convergence: "queued" },
  { success: false, error: "Add-on state unknown", code: "addon_state_unknown", stripeSubscriptionItemId: "si_1" },
  { success: false, error: "Remove an extra MLO first", code: "extra_mlos_exceed_quantity", activeLoginless: 3, quantity: 2 },
  { success: false, error: "Remove a team member first", code: "members_exceed_quantity", activeMembers: 6, quantity: 5 },
  { success: false, error: "A code a later Rello adds", code: "some_later_code" },
];

// The exact domain branches still narrow to their fields.
export function seatsShort(e: AddOnQuantityError): number | null {
  if (isExtraMlosExceedQuantityError(e)) return e.activeLoginless - e.quantity;
  if (isMembersExceedQuantityError(e)) return e.activeMembers - e.quantity;
  return null;
}
