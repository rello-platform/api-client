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
  /** Custom fields to set on the lead (initial value on create). For merging later, use setCustomFields(). */
  customFields?: Record<string, unknown>;
  /** HomeReady assessment score (0-100). */
  homeReadyScore?: number;
  /** Source detail (e.g., campaign name, referral context). */
  sourceDetail?: string;
  /** Explicit agent assignment — Rello User ID. Bypasses routing engine. */
  assignedAgentId?: string;
  /** MLO assignment — Rello User ID. */
  assignedMloId?: string;
  /** Which apps contributed data to this lead (e.g., ["HOMEREADY"]). */
  appsUsed?: string[];
}

export interface UpdateLeadInput {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  source?: string;
  propertyType?: string;
  priceRange?: string;
  timeline?: string;
  areas?: string[];
  currentStage?: string;
  score?: number;
  homeReadyScore?: number;
  assignedAgentId?: string;
  assignedMloId?: string;
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
  /** Filter leads by assigned agent (Rello User ID). */
  agentId?: string;
}

/** Paginated leads response — preserves the pagination envelope from the server. */
export interface LeadsPage {
  leads: Lead[];
  total: number;
  page: number;
  totalPages: number;
}

export interface NurtureDecision {
  framework: string | null;
  contentDirection: string | null;
  contentPhase: string | null;
}

export interface NurtureDecisionParams {
  limit?: number;
  action?: string;
}

export interface FindByTagsInput {
  tagSlugs: string[];
  operator: "AND" | "OR";
  excludeTagSlugs?: string[];
  limit?: number;
  offset?: number;
}

export interface FindByTagsResult {
  leads: Lead[];
  total: number;
}

export interface BatchTagsResult {
  leadTags: Record<string, Array<{ id: string; name: string; slug: string; category: string; color: string }>>;
  found: number;
  requested: number;
}

export interface ConversionScore {
  score: number;
  factors: Record<string, unknown>;
  updatedAt: string;
}
