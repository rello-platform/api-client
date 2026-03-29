export interface Lead {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  currentStage: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  referralSource: string | null;
  customFields: Record<string, unknown> | null;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Input for creating a lead in Rello.
 *
 * Field names match Rello's createLeadSchema (src/lib/leads/validation.ts).
 * Rello uses Zod validation — unknown fields are stripped, so only fields
 * listed here will be accepted by the server.
 */
export interface CreateLeadInput {
  /** Required by Rello (server returns 400 if empty). */
  firstName?: string;
  /** Required by Rello (server returns 400 if empty). */
  lastName?: string;
  email?: string;
  phone?: string;
  /** Lead source (e.g., "newsletter_studio", "the-home-scout"). */
  source?: string;
  /** Property type interest (e.g., "single_family", "condo"). */
  propertyType?: string;
  /** Price range interest. */
  priceRange?: string;
  /** Buying/selling timeline. */
  timeline?: string;
  /** Geographic areas of interest. */
  areas?: string[];
  /**
   * Agent/owner ID for lead assignment.
   * If omitted, Rello's routing engine assigns based on rules.
   * This is the Rello User ID of the agent, NOT an app-specific agent ID.
   */
  ownerId?: string;
  /** Tag IDs to apply on creation. */
  tagIds?: string[];
  /** MLO partner ID for lead sharing. */
  mloPartnerId?: string;
  /** Guest MLO ID for lead sharing. */
  providingGuestMLOId?: string;
  /** Trigger HomeReady app invite email on creation. */
  sendHomeReadyInvite?: boolean;
  /** Custom fields to set on the lead. Merged into Lead.customFields. */
  customFields?: Record<string, unknown>;
}

export interface UpdateLeadInput {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  currentStage?: string;
  customFields?: Record<string, unknown>;
  coBorrowerFirstName?: string;
  coBorrowerLastName?: string;
  coBorrowerSource?: string;
  coBorrowerUpdatedAt?: string;
  [key: string]: unknown;
}

export interface ListLeadsParams {
  limit?: number;
  offset?: number;
  page?: number;
  tags?: string[];
  email?: string;
  search?: string;
  stage?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface ConversionScore {
  score: number;
  factors: Record<string, unknown>;
  updatedAt: string;
}
