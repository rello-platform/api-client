import type { AppSlug } from "@rello-platform/slugs";

/**
 * Entity-shape classification for a Lead. Mirrors the EntityType union
 * exported from `@rello-platform/lead-entity` (the canonical source of truth
 * for the classifier + normalizer pure-functions). Duplicated here as a
 * literal to avoid a circular package dependency at this layer; a follow-up
 * bump may fold this into a named import once consumer pin orderings settle.
 */
export type EntityType =
  | "INDIVIDUAL"
  | "LLC"
  | "PARTNERSHIP"
  | "TRUST"
  | "CORPORATION"
  | "OTHER";

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
  /** Canonical Format-2 AppSlug identifying the originating app (e.g., "home-ready", "harvest-home"). Rello rejects legacy Format-3 UPPERCASE-concat and Format-4 UPPERCASE_UNDERSCORE values at the zod boundary. */
  source?: AppSlug;
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
  /** Which apps contributed data to this lead, as canonical Format-2 AppSlugs (e.g., ["home-ready"]). */
  appsUsed?: AppSlug[];
  /**
   * Entity-shape classification. Defaults to INDIVIDUAL on the Rello server
   * when omitted. When non-INDIVIDUAL, `entityName` must accompany this
   * value; for INDIVIDUAL, `entityName` must be omitted. The classifier +
   * normalizer pure-functions live in `@rello-platform/lead-entity`.
   */
  entityType?: EntityType;
  /**
   * Raw entity name as captured from the upstream source (BYOL CSV row,
   * intake API payload, manual entry). Preserves casing + punctuation for
   * display. Required when `entityType !== "INDIVIDUAL"`. Rello derives
   * `entityNameNormalized` server-side via `normalizeEntityName`.
   */
  entityName?: string;
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

/** Response from GET /api/leads/[id]/context-cache */
export interface ContextCacheResponse {
  exists: boolean;
  leadId: string;
  narrative?: string;
  emotionalState?: string;
  sourcesPresent?: number;
  sourcesTotal?: number;
  computedAt?: string;
  isStale?: boolean;
  freshnessLabel?: string;
  refreshReason?: string | null;
}

/** Input for POST /api/v1/leads/:id/offline-interactions */
export interface RecordOfflineInteractionInput {
  /** Interaction type. One of: "call", "meeting", "showing", "open_house", "note". */
  type: "call" | "phone_call" | "meeting" | "showing" | "open_house" | "note";
  /** Interaction outcome (required). */
  outcome: string;
  /** Free-text notes (optional). */
  notes?: string;
  /** Duration in minutes (optional). */
  duration?: number;
  /** Sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "MIXED". Defaults to NEUTRAL. */
  sentiment?: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "MIXED";
  /** ISO timestamp of when the interaction occurred. Defaults to now. */
  occurredAt?: string;
  /** Source app slug (optional). */
  source?: string;
  /** Agent ID override (optional — defaults to lead's assigned agent). */
  agentId?: string;
}

/** Response from POST /api/v1/leads/:id/offline-interactions */
export interface OfflineInteractionResponse {
  interaction: {
    id: string;
    tenantId: string;
    leadId: string;
    agentId: string;
    type: string;
    sentiment: string;
    duration: number | null;
    notes: string | null;
    outcome: string;
    occurredAt: string;
    createdAt: string;
    [key: string]: unknown;
  };
}
