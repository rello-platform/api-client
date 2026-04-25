import type { PlatformSlug } from "@rello-platform/slugs";

/**
 * Canonical permissions registry for the Rello platform.
 *
 * Single source of truth for every permission slug an `ApiKey` row may hold
 * and every receiver — Rello or any spoke — gates on. Mirrors the
 * `@rello-platform/slugs` pattern: one shared package, compile-time-checked
 * keys, derived runtime arrays. Resolves the cross-repo split-brain
 * documented in DISCOVERED-PERMISSIONS-REGISTRY-CROSS-REPO-DRIFT-042526.
 *
 * Adding a new permission:
 *   1. Add the entry below with `slug`, `label`, `description`, `validatedBy`.
 *   2. Bump api-client minor version, tag, push.
 *   3. Migrate the receiver to `import { PERMISSIONS } from
 *      "@rello-platform/api-client"` and gate on `PERMISSIONS.<KEY>.slug`.
 *   4. Update Rello's picker (auto-derived from this list — no edit needed).
 *   5. Tick the new permission on any caller `ApiKey` row that needs it.
 *
 * Removing a permission:
 *   - First confirm no receiver references it via constant OR string literal
 *     (`grep -rn "PERMISSIONS\\.<KEY>\\|<slug>" ~/Rello ~/<every-spoke>/src`).
 *   - String-grep alone is unreliable when receivers reference the constant
 *     form; `tsc --noEmit` after the removal commit is the durable check
 *     (see DISCOVERED-RELLO-PERMISSIONS-CONST-BROKEN-REFS-042526).
 */

export interface PermissionDefinition {
  /** The string slug stored on `ApiKey.permissions` and checked by receivers. */
  readonly slug: string;
  /** Human-readable label used by Rello's picker UI. */
  readonly label: string;
  /** Sentence-form description shown in picker tooltips and minted-key audits. */
  readonly description: string;
  /**
   * Apps/engines that gate on this permission in their receiver code. Used by
   * the picker for "validated by" badges and by future audits to grep
   * `validatedBy: ["<slug>"]` and find every permission a given app enforces.
   */
  readonly validatedBy: readonly PlatformSlug[];
}

/**
 * Every permission slug recognized by the platform. Keys are
 * UPPERCASE_UNDERSCORE versions of the slug (with `:` and `-` mapped to `_`).
 *
 * Receivers MUST gate on `PERMISSIONS.<KEY>.slug` (typed) — never on a
 * string literal — so a typo or removal trips `tsc --noEmit` immediately.
 */
export const PERMISSIONS = {
  // ─── Leads / contacts ─────────────────────────────────────────────────────
  CONTACTS_READ: {
    slug: "contacts:read",
    label: "Read contacts",
    description: "Read lead/contact records via /api/contacts and related read paths.",
    validatedBy: ["rello"],
  },
  CONTACTS_WRITE: {
    slug: "contacts:write",
    label: "Write contacts",
    description: "Create or update lead/contact records via /api/contacts.",
    validatedBy: ["rello"],
  },
  CONTACTS_DELETE: {
    slug: "contacts:delete",
    label: "Delete contacts",
    description: "Delete lead/contact records via /api/contacts.",
    validatedBy: ["rello"],
  },
  LEADS_READ: {
    slug: "leads:read",
    label: "Read leads",
    description: "Read lead records via /api/leads and related read paths.",
    validatedBy: ["rello"],
  },
  LEADS_WRITE: {
    slug: "leads:write",
    label: "Write leads",
    description: "Create or update lead records via /api/leads.",
    validatedBy: ["rello"],
  },
  LEADS_DELETE: {
    slug: "leads:delete",
    label: "Delete leads",
    description: "Delete lead records via /api/leads.",
    validatedBy: ["rello"],
  },

  // ─── Journeys ─────────────────────────────────────────────────────────────
  JOURNEYS_READ: {
    slug: "journeys:read",
    label: "Read journeys",
    description: "Read journey definitions and enrollments.",
    validatedBy: ["rello"],
  },
  JOURNEYS_WRITE: {
    slug: "journeys:write",
    label: "Write journeys",
    description: "Create or update journey definitions and enrollments.",
    validatedBy: ["rello"],
  },
  JOURNEYS_EXECUTE: {
    slug: "journeys:execute",
    label: "Execute journeys",
    description: "Trigger journey execution steps.",
    validatedBy: ["rello"],
  },

  // ─── Webhooks ─────────────────────────────────────────────────────────────
  WEBHOOKS_READ: {
    slug: "webhooks:read",
    label: "Read webhooks",
    description: "Read webhook subscription configuration.",
    validatedBy: ["rello"],
  },
  WEBHOOKS_WRITE: {
    slug: "webhooks:write",
    label: "Write webhooks",
    description: "Create or update webhook subscriptions.",
    validatedBy: ["rello"],
  },
  WEBHOOKS_DELIVER: {
    slug: "webhooks:deliver",
    label: "Deliver outbound webhook",
    description: "Rello → spoke outbound webhook delivery. Attached to per-spoke (appSource=RELLO, targetApp=<SPOKE>) keys; checked by the spoke's receiver after the Bearer hash matches. Replaces the HMAC signature pattern per DISCOVERED-WEBHOOK-SIGNATURE-HEADER-MISMATCH-042226.",
    validatedBy: ["newsletter-studio"],
  },

  // ─── Events ───────────────────────────────────────────────────────────────
  EVENTS_WRITE: {
    slug: "events:write",
    label: "Write events",
    description: "Write events into Rello's event stream — used by spoke webhooks (Rello receives newsletter open/click/bounce/unsubscribe, drumbeat post events, etc.) and by Rello-internal callers.",
    validatedBy: ["rello"],
  },

  // ─── Engines (platform service auth) ──────────────────────────────────────
  ENGINE_ACCESS: {
    slug: "engine:access",
    label: "Engine access",
    description: "Allows a key to call platform-service engine endpoints (Milo, Property, Content, Report, Journey, Drumbeat Video). Required for any engine-cluster receiver per Auth-Fragmentation Phase 2.",
    validatedBy: [
      "milo-engine",
      "property-engine",
      "content-engine",
      "report-engine",
      "journey-engine",
      "drumbeat-video-engine",
    ],
  },

  // ─── Newsletter Studio (Rello → NS dispatch) ──────────────────────────────
  NEWSLETTERS_SEND: {
    slug: "newsletters:send",
    label: "Send newsletter (per-recipient nurture)",
    description: "Rello → NS dispatch via /api/newsletters/blueprint-send. Required for per-recipient nurture sends to flow through the centralized NS pipeline. Closed a SHAPE-01-class env-var Bearer compare per DISCOVERED-RELLO-NS-ENV-DRIFT-042426.",
    validatedBy: ["newsletter-studio"],
  },

  TENANTS_VALIDATE: {
    slug: "tenants:validate",
    label: "Validate tenants",
    description: "Cross-app tenant validation lookups.",
    validatedBy: ["rello"],
  },

  // ─── Newsletter Studio — Flow CRUD (LEAD-COHORT-CAMPAIGN-BUILDER Phase 3) ─
  FLOWS_CREATE: {
    slug: "flows:create",
    label: "Create flow",
    description: "NS receiver — POST /api/flows. Used by Rello → NS launchCampaign. Kept narrow so a compromised key cannot exfiltrate newsletters / messaging / contacts.",
    validatedBy: ["newsletter-studio"],
  },
  FLOWS_MANAGE: {
    slug: "flows:manage",
    label: "Manage flow",
    description: "NS receiver — GET/PUT/DELETE /api/flows/[id]. Used by Rello → NS launchCampaign + addLeadsToCampaign.",
    validatedBy: ["newsletter-studio"],
  },
  FLOWS_SUBSCRIBE: {
    slug: "flows:subscribe",
    label: "Subscribe leads to flow",
    description: "NS receiver — POST /api/flows/[id]/leads. Used by Rello → NS addLeadsToCampaign.",
    validatedBy: ["newsletter-studio"],
  },
  FLOWS_READ_MILO_MANAGED: {
    slug: "flows:read-milo-managed",
    label: "Read Milo-managed flows",
    description: "NS receiver — GET /api/flows/milo-managed/leads. Used by Rello to read enrollment state on Milo-managed flows during nurture decisions.",
    validatedBy: ["newsletter-studio"],
  },

  // ─── Newsletter Studio — engagement / preferences / suppression ───────────
  ENGAGEMENT_READ: {
    slug: "engagement:read",
    label: "Read engagement",
    description: "NS receiver — GET /api/leads/[id]/engagement. Used by Milo Engine and Rello to read NS-side engagement summaries (open/click history, last-engagement timestamps).",
    validatedBy: ["newsletter-studio"],
  },
  INJECTIONS_READ: {
    slug: "injections:read",
    label: "Read content injections",
    description: "NS receiver — GET /api/injections/active. Used by Milo Engine and Rello to read the active content-injection rules NS will apply at compose time.",
    validatedBy: ["newsletter-studio"],
  },
  SUBJECT_PREFERENCES_READ: {
    slug: "subject-preferences:read",
    label: "Read subject preferences",
    description: "NS receiver — GET /api/internal/subject-preferences. Used by Milo Engine to read tenant-level subject-line generation preferences.",
    validatedBy: ["newsletter-studio"],
  },
  SUPPRESSION_LIFT: {
    slug: "suppression:lift",
    label: "Lift suppression (NS receiver)",
    description: "NS receiver — POST /api/webhooks/rello/suppression-lift. Used by Rello to confirm a re-opt-in has happened so NS can clear the local Suppression row.",
    validatedBy: ["newsletter-studio"],
  },

  // ─── Agents ───────────────────────────────────────────────────────────────
  AGENTS_READ: {
    slug: "agents:read",
    label: "Read agents",
    description: "Read agent profile / roster records.",
    validatedBy: ["rello"],
  },
  AGENTS_WRITE: {
    slug: "agents:write",
    label: "Write agents",
    description: "Create or update agent profile records.",
    validatedBy: ["rello"],
  },

  // ─── Articles ─────────────────────────────────────────────────────────────
  ARTICLES_SYNC: {
    slug: "articles:sync",
    label: "Sync articles",
    description: "Content Engine → Rello article sync ingest.",
    validatedBy: ["rello"],
  },

  // ─── Messaging ────────────────────────────────────────────────────────────
  MESSAGING_READ: {
    slug: "messaging:read",
    label: "Read messaging",
    description: "Read SMS / message thread records.",
    validatedBy: ["rello"],
  },
  MESSAGING_SEND: {
    slug: "messaging:send",
    label: "Send messaging",
    description: "Send SMS / message via Rello's messaging path.",
    validatedBy: ["rello"],
  },
  MESSAGING_ADMIN: {
    slug: "messaging:admin",
    label: "Administer messaging",
    description: "Administrative messaging operations (provider config, etc.).",
    validatedBy: ["rello"],
  },

  // ─── Conversations ────────────────────────────────────────────────────────
  CONVERSATIONS_READ: {
    slug: "conversations:read",
    label: "Read conversations",
    description: "Read conversation thread records.",
    validatedBy: ["rello"],
  },
  CONVERSATIONS_WRITE: {
    slug: "conversations:write",
    label: "Write conversations",
    description: "Create or update conversation thread records.",
    validatedBy: ["rello"],
  },
  CONVERSATIONS_CALL: {
    slug: "conversations:call",
    label: "Initiate calls",
    description: "Initiate or update voice-call conversation records.",
    validatedBy: ["rello"],
  },

  // ─── Documents ────────────────────────────────────────────────────────────
  DOCUMENTS_READ: {
    slug: "documents:read",
    label: "Read documents",
    description: "Read document/asset records.",
    validatedBy: ["rello"],
  },
  DOCUMENTS_WRITE: {
    slug: "documents:write",
    label: "Write documents",
    description: "Upload or update document/asset records.",
    validatedBy: ["rello"],
  },

  // ─── Signals ──────────────────────────────────────────────────────────────
  SIGNALS_WRITE: {
    slug: "signals:write",
    label: "Write signals",
    description: "Spoke → Rello signal ingest via /api/signals/batch and /api/signals/ingest. Held by every spoke's outbound key.",
    validatedBy: ["rello"],
  },

  // ─── Intake (Rello → HH per-caller credential, NA-080) ────────────────────
  INTAKE_WRITE: {
    slug: "intake:write",
    label: "Write intake",
    description: "Rello → Harvest Home /api/intake[/re-enrich[-batch]] per-caller credential. Replaces the shared INTAKE_APP_SECRET env var per NA-080 (Plan-A2). HH's requireIntakeBearer enforces this permission via createPlatformKeyValidator.",
    validatedBy: ["harvest-home"],
  },

  // ─── Tags ─────────────────────────────────────────────────────────────────
  TAGS_READ: {
    slug: "tags:read",
    label: "Read tags",
    description: "Read tag records.",
    validatedBy: ["rello"],
  },
  TAGS_WRITE: {
    slug: "tags:write",
    label: "Write tags",
    description: "Create or update tag records.",
    validatedBy: ["rello"],
  },
  TAGS_DELETE: {
    slug: "tags:delete",
    label: "Delete tags",
    description: "Delete tag records.",
    validatedBy: ["rello"],
  },

  // ─── Routing ──────────────────────────────────────────────────────────────
  ROUTING_EVALUATE: {
    slug: "routing:evaluate",
    label: "Evaluate routing rules",
    description: "Run lead-routing rule evaluation.",
    validatedBy: ["rello"],
  },
  ROUTING_READ: {
    slug: "routing:read",
    label: "Read routing rules",
    description: "Read lead-routing rule definitions.",
    validatedBy: ["rello"],
  },

  // ─── Pools ────────────────────────────────────────────────────────────────
  POOLS_READ: {
    slug: "pools:read",
    label: "Read lead pools",
    description: "Read lead-pool records.",
    validatedBy: ["rello"],
  },
  POOLS_WRITE: {
    slug: "pools:write",
    label: "Write lead pools",
    description: "Create or update lead-pool records.",
    validatedBy: ["rello"],
  },

  // ─── Segments ─────────────────────────────────────────────────────────────
  SEGMENTS_READ: {
    slug: "segments:read",
    label: "Read segments",
    description: "Read saved-segment records via /api/segments and /api/segments/[id]. Used by NS targeting paths to enumerate Rello segments.",
    validatedBy: ["rello"],
  },
  SEGMENTS_WRITE: {
    slug: "segments:write",
    label: "Write segments",
    description: "Create, update, or delete saved-segment records.",
    validatedBy: ["rello"],
  },

  // ─── Scoring (Auth-Fragmentation Phase 3) ─────────────────────────────────
  SCORING_READ: {
    slug: "scoring:read",
    label: "Read scoring config",
    description: "HomeReady scoring-engine receivers — GET /api/scoring/{config,dpa,guidelines,programs}. Phase 3 of Auth-Fragmentation.",
    validatedBy: ["rello"],
  },
  SCORING_WRITE: {
    slug: "scoring:write",
    label: "Write scoring",
    description: "HomeReady scoring-engine receivers — POST /api/scoring/{calculate,live-updates}. Phase 3 of Auth-Fragmentation.",
    validatedBy: ["rello"],
  },

  // ─── Reports / app scores (Auth-Fragmentation Phase 3) ────────────────────
  REPORTS_WRITE: {
    slug: "reports:write",
    label: "Write reports",
    description: "Spoke → Rello daily report ingest via /api/reports/ingest.",
    validatedBy: ["rello"],
  },
  APP_SCORES_WRITE: {
    slug: "app-scores:write",
    label: "Write app scores",
    description: "Spoke → Rello per-lead score ingest via /api/leads/[id]/app-scores.",
    validatedBy: ["rello"],
  },

  // ─── Social integrations ──────────────────────────────────────────────────
  SOCIAL_READ: {
    slug: "social:read",
    label: "Read social credentials",
    description: "Drumbeat runtime OAuth credential fetch via /api/admin/integrations/social-credentials.",
    validatedBy: ["rello"],
  },

  // ─── Re-opt-in / suppression-lift (SPAM-COMPLAINT-REOPT-IN-PATH §4.5) ─────
  REOPT_IN_DISPATCH: {
    slug: "reopt-in:dispatch",
    label: "Dispatch re-opt-in",
    description: "Rello → NS outbound permission allowing the complianceExempt: true body flag on blueprint-send. Without it, NS ignores the flag (fail-safe).",
    validatedBy: ["newsletter-studio"],
  },
  REOPT_IN_CONFIRM: {
    slug: "reopt-in:confirm",
    label: "Confirm re-opt-in",
    description: "NS → Rello inbound permission for POST /api/reopt-in/confirm.",
    validatedBy: ["rello"],
  },
  REOPT_IN_LOOKUP: {
    slug: "reopt-in:lookup",
    label: "Lookup re-opt-in",
    description: "NS → Rello inbound permission for GET /api/reopt-in/lookup.",
    validatedBy: ["rello"],
  },
  SUPPRESSION_LIFT_WRITE: {
    slug: "suppression-lift:write",
    label: "Write suppression-lift webhook",
    description: "Rello → NS outbound permission for POST /api/webhooks/rello/suppression-lift. Different from suppression:lift — that's NS's receiver permission; this is the slug Rello's outbound key holds to call it. Distinct slugs preserved per Phase 1 inventory.",
    validatedBy: ["newsletter-studio"],
  },
} as const satisfies Record<string, PermissionDefinition>;

/** Compile-time-checked permission key (e.g., `"NEWSLETTERS_SEND"`). */
export type PermissionKey = keyof typeof PERMISSIONS;

/** Compile-time-checked permission slug (e.g., `"newsletters:send"`). */
export type Permission = (typeof PERMISSIONS)[PermissionKey]["slug"];

/**
 * Every recognized permission slug. Picker UI iterates this array; write-time
 * validators accept any value in this list (plus the `*` wildcard meta-grant).
 */
export const ALL_PERMISSION_SLUGS: readonly Permission[] = Object.values(
  PERMISSIONS,
).map((p) => p.slug as Permission);

/** Read-only Set for fast `.has()` checks. */
export const PERMISSION_SLUG_SET: ReadonlySet<Permission> = new Set<Permission>(
  ALL_PERMISSION_SLUGS,
);

/**
 * Wildcard meta-grant. A key with `"*"` in `permissions` matches any permission
 * check. Held by the platform-superuser key only; never granted to spoke keys.
 *
 * Not a registered permission — separated from `ALL_PERMISSION_SLUGS` so the
 * picker doesn't surface it as a tickable option.
 */
export const WILDCARD_PERMISSION = "*" as const;

/**
 * Type guard: is the input a recognized permission slug? Pass on `*` to also
 * accept the wildcard meta-grant.
 */
export function isPermissionSlug(
  value: string,
  options?: { allowWildcard?: boolean },
): value is Permission | typeof WILDCARD_PERMISSION {
  if (options?.allowWildcard && value === WILDCARD_PERMISSION) return true;
  return PERMISSION_SLUG_SET.has(value as Permission);
}

/**
 * The full set of values the API-key write-time validator should accept,
 * including the wildcard meta-grant. Equal to
 * `[...ALL_PERMISSION_SLUGS, "*"]`; computed as a typed readonly array so
 * downstream consumers do not have to recompute it.
 */
export const VALID_PERMISSION_VALUES: readonly (
  | Permission
  | typeof WILDCARD_PERMISSION
)[] = [...ALL_PERMISSION_SLUGS, WILDCARD_PERMISSION];
