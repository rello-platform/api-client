/**
 * Shared provisioning payload types for Rello ↔ spoke app communication.
 *
 * These schemas define the EXACT shapes that flow across the HTTP boundary
 * when Rello provisions tenants/agents into spoke apps. Both the Rello
 * sender and spoke receivers should validate against these schemas.
 *
 * PROVISIONING-AUDIT-2026-04-08: This file was created to close the
 * "type lies across HTTP boundaries" root-cause finding (Stage 7 #5).
 * Prior to this, each spoke had its own type definitions that had drifted
 * from what Rello actually sends, causing 8+ CRITICALs across 3 spokes.
 *
 * Schema updates MUST be coordinated: changing a field here requires
 * updating the Rello sender AND rebuilding every spoke that imports it.
 * CI will catch mismatches at build time.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Agent shape (shared between tenant-enable and agent-provision payloads)
// ---------------------------------------------------------------------------

/**
 * Agent fields sent by Rello in provisioning payloads.
 *
 * This is the CANONICAL shape. Spoke receivers must NOT assume fields
 * beyond what's listed here (e.g., HH's old `name` field or `territories`
 * were never sent by Rello — they were type lies).
 */
export const provisionedAgentSchema = z.object({
  relloAgentId: z.string(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  slug: z.string(),
  role: z.string(), // "MLO" | "BROKER" | "AGENT" — kept as string for forward-compat
  phone: z.string().nullable(),

  // Optional profile fields — present when the agent has filled them in
  photoUrl: z.string().optional(),
  bio: z.string().optional(),
  title: z.string().optional(),
  tagline: z.string().optional(),
  brokerageName: z.string().optional(),
  brokerageLogoUrl: z.string().optional(),
  brokerageLicenseNumber: z.string().optional(),
  licenseNumber: z.string().optional(),
  licenseState: z.string().optional(),
  nmlsNumber: z.string().optional(),
  websiteUrl: z.string().optional(),
  applicationUrl: z.string().optional(),
  social: z.unknown().optional(),

  // Tenant-owner MLO info — applied to ALL agents in the tenant-enable payload.
  // For solo MLOs this is the agent's own NMLS; for brokerages it's the owner's.
  mloName: z.string().optional(),
  mloNmls: z.string().optional(),

  // PTA-013 F-06: Milo profile + wizard answers per agent in tenant-enable payloads.
  // Present when agent has completed the Rello Start Wizard. Only sent in
  // tenant-enable (bulk) — per-agent provision carries these at the top level.
  agentProfile: z.lazy(() => agentProfileSchema).optional(),
  wizardAnswers: z.array(z.lazy(() => wizardAnswerSchema)).optional(),
});

export type ProvisionedAgent = z.infer<typeof provisionedAgentSchema>;

// ---------------------------------------------------------------------------
// Tenant enable payload
// ---------------------------------------------------------------------------

export const tenantEnablePayloadSchema = z.object({
  action: z.literal("enable"),
  relloTenantId: z.string(),
  tenant: z.object({
    name: z.string(),
    slug: z.string(),
    logoUrl: z.string().nullable(),
    primaryColor: z.string().nullable(),
    physicalAddress: z.string().nullable(),
    applicationUrl: z.string().nullable(),
    type: z.string(), // Rello TenantType enum
    plan: z.string(), // Rello Plan enum
  }),
  agents: z.array(provisionedAgentSchema),
  // HH-specific: initial credit grant for new tenants. Optional — only
  // sent when the spoke app has a credit system (currently only HH).
  // Spokes without credits ignore this field.
  creditAllocation: z.object({
    initialBalance: z.number().optional(),
    poolSize: z.number().nullable().optional(),
  }).optional(),
});

export type TenantEnablePayload = z.infer<typeof tenantEnablePayloadSchema>;

// ---------------------------------------------------------------------------
// Tenant disable payload
// ---------------------------------------------------------------------------

export const tenantDisablePayloadSchema = z.object({
  action: z.literal("disable"),
  relloTenantId: z.string(),
  reason: z.string().optional(),
});

export type TenantDisablePayload = z.infer<typeof tenantDisablePayloadSchema>;

// ---------------------------------------------------------------------------
// Combined tenant provisioning payload (discriminated union on `action`)
// ---------------------------------------------------------------------------

export const tenantProvisioningPayloadSchema = z.discriminatedUnion("action", [
  tenantEnablePayloadSchema,
  tenantDisablePayloadSchema,
]);

export type TenantProvisioningPayload = z.infer<typeof tenantProvisioningPayloadSchema>;

// ---------------------------------------------------------------------------
// Agent provisioning payload (per-agent sync via agent-provision-sync task)
// ---------------------------------------------------------------------------

export const agentProfileSchema = z.object({
  specialtySentence: z.string().optional(),
  experienceStatement: z.string().optional(),
  typicalClient: z.unknown().optional(),
  areasServed: z.unknown().optional(),
  designations: z.unknown().optional(),
  emailTone: z.string().optional(),
  soloOrTeam: z.string().optional(),
  preferredContactMethod: z.string().optional(),
  calendarLink: z.string().optional(),
  aboutMeFacts: z.unknown().optional(),
  avoidTopics: z.unknown().optional(),
  emphasizeTopics: z.unknown().optional(),
  sensitiveTopics: z.unknown().optional(),
  introductionDraft: z.string().optional(),
  signoffStyle: z.string().optional(),
  successStorySeeds: z.unknown().optional(),
  sendFrequency: z.string().optional(),
  newsletterTemplateId: z.string().optional(),
  brandColors: z.unknown().optional(),
  leadSourceContext: z.unknown().optional(),
});

export const wizardAnswerSchema = z.object({
  questionId: z.string(),
  question: z.string(),
  answer: z.unknown(),
});

export const agentProvisionPayloadSchema = z.object({
  action: z.enum(["add", "update", "remove"]),
  relloTenantId: z.string(),
  agent: provisionedAgentSchema,
  agentProfile: agentProfileSchema.optional(),
  wizardAnswers: z.array(wizardAnswerSchema).optional(),
  // PTA-013 F-05: Tenant physical address sent alongside per-agent sync.
  // CAN-SPAM compliance — spokes persist this on their local Tenant model.
  physicalAddress: z.unknown().nullable().optional(),
});

export type AgentProvisionPayload = z.infer<typeof agentProvisionPayloadSchema>;

// ---------------------------------------------------------------------------
// Validation helpers — for use at the spoke receiver boundary
// ---------------------------------------------------------------------------

/**
 * Parse and validate an incoming tenant provisioning request body.
 * Returns the typed payload on success, or an error message on failure.
 *
 * Usage in a spoke receiver:
 * ```ts
 * const result = parseTenantPayload(await req.json());
 * if (!result.success) return badRequestResponse(result.error);
 * const payload = result.data;
 * ```
 */
export function parseTenantPayload(body: unknown):
  | { success: true; data: TenantProvisioningPayload }
  | { success: false; error: string } {
  const result = tenantProvisioningPayloadSchema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const issues = result.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
  return { success: false, error: `Payload validation failed: ${issues}` };
}

/**
 * Parse and validate an incoming agent provisioning request body.
 */
export function parseAgentPayload(body: unknown):
  | { success: true; data: AgentProvisionPayload }
  | { success: false; error: string } {
  const result = agentProvisionPayloadSchema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const issues = result.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
  return { success: false, error: `Payload validation failed: ${issues}` };
}
