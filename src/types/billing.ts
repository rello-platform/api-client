export interface CheckoutInput {
  productType: string;
  quantity?: number;
  unitPriceCents?: number;
  returnUrl: string;
  app?: string;
  plan?: string;
}

export interface UsageInput {
  metric: string;
  quantity: number;
  metadata?: Record<string, unknown>;
}

export interface BillingStatus {
  subscription: unknown;
  addOns: unknown[];
  usage: unknown;
  limits: unknown;
}

export interface EntitlementResult {
  allowed: boolean;
  tier?: string;
  limits?: Record<string, unknown>;
  expiresAt?: string;
  trialEndsAt?: string;
  isTrialing?: boolean;
  isExpired?: boolean;
}
