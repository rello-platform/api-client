/**
 * PFP Gateway X2: PathfinderPro → Rello roster routes (spec SPEC-PFP-GATEWAY.md
 * rev 10.30 §6 "[D30] Extra-signature MLOs", G-EXTRAS, D33; Platform KA prompts
 * 1152/1155, plan a4-1151 ruled). One contract for Rello's routes and PFP's callers.
 *
 * Auth on every route: `Authorization: Bearer <ApiKey>` (Rello's ApiKey table,
 * targetApp RELLO), the route's narrow permission (`agents:loginless:write` /
 * `team:members:write`), the key's appSource enabled for the tenant, a
 * tenant-bound key naming only its own tenant, and `actingRelloUserId` an active
 * owner of that tenant. The tenant is never taken from a header.
 *
 *   POST /api/provisioning/loginless-agent                       (X2a)
 *   POST /api/provisioning/loginless-agent/[agentId]/remove      (X2a)
 *   POST /api/provisioning/team-member                           (X2b)
 *   POST /api/provisioning/team-member/[userId]/sign-in-link     (X2b)
 *   POST /api/provisioning/team-member/[userId]/remove           (X2b)
 */
import { z } from "zod";

const rosterIdField = (name: string) =>
  z.string({ error: `${name} is required and must be a string` }).trim().min(1, `${name} is required`).max(128, `${name} is too long`);
const rosterNameField = (name: string) =>
  z.string({ error: `${name} is required and must be a string` }).trim().min(1, `${name} is required`).max(100, `${name} is too long`);
const rosterEmailField = z
  .string({ error: "email is required and must be a string" })
  .trim()
  .toLowerCase()
  .max(254, "email is too long")
  .pipe(z.email("email is not a valid address"));
/** Minted by the caller once per Add click and kept until it gets an answer. */
const rosterRequestIdField = z
  .string({ error: "requestId is required and must be a string" })
  .trim()
  .min(8, "requestId must be 8 to 200 characters")
  .max(200, "requestId must be 8 to 200 characters");

// ─── Loginless agent (D30 extra-signature loan officer) ─────────────────────

/** Only name and email: NMLS, licensed states, phone and photo are Home Scout's (§4.9). */
export const loginlessAgentCreateRequestSchema = z
  .object({
    tenantId: rosterIdField("tenantId"),
    actingRelloUserId: rosterIdField("actingRelloUserId"),
    firstName: rosterNameField("firstName"),
    lastName: rosterNameField("lastName"),
    email: rosterEmailField,
    requestId: rosterRequestIdField,
  })
  .strict();
export type LoginlessAgentCreateRequest = z.infer<typeof loginlessAgentCreateRequestSchema>;

/** 201 on create; 200 with `replayed: true` for the same requestId and body. */
export interface LoginlessAgentCreateResponse {
  relloAgentId: string;
  slug: string;
  email: string;
  replayed: boolean;
}

export const loginlessAgentRemoveRequestSchema = z
  .object({ tenantId: rosterIdField("tenantId"), actingRelloUserId: rosterIdField("actingRelloUserId") })
  .strict();
export type LoginlessAgentRemoveRequest = z.infer<typeof loginlessAgentRemoveRequestSchema>;

/** 200. Remove sets the agent INACTIVE; nothing is deleted. */
export interface LoginlessAgentRemoveResponse {
  relloAgentId: string;
  status: "INACTIVE";
  alreadyInactive: boolean;
}

// ─── Team member (D33 6th–10th login) ───────────────────────────────────────

export const teamMemberCreateRequestSchema = z
  .object({
    tenantId: rosterIdField("tenantId"),
    actingRelloUserId: rosterIdField("actingRelloUserId"),
    email: rosterEmailField,
    firstName: rosterNameField("firstName"),
    lastName: rosterNameField("lastName"),
    requestId: rosterRequestIdField,
  })
  .strict();
export type TeamMemberCreateRequest = z.infer<typeof teamMemberCreateRequestSchema>;

export interface TeamMemberCreateResponse {
  userId: string;
  relloAgentId: string;
  email: string;
  signInEmail: "queued";
  replayed: boolean;
}

export const teamMemberSignInLinkRequestSchema = z
  .object({ tenantId: rosterIdField("tenantId"), actingRelloUserId: rosterIdField("actingRelloUserId") })
  .strict();
export type TeamMemberSignInLinkRequest = z.infer<typeof teamMemberSignInLinkRequestSchema>;

export const teamMemberRemoveRequestSchema = z
  .object({ tenantId: rosterIdField("tenantId"), actingRelloUserId: rosterIdField("actingRelloUserId") })
  .strict();
export type TeamMemberRemoveRequest = z.infer<typeof teamMemberRemoveRequestSchema>;

export interface TeamMemberRemoveResponse {
  userId: string;
  isActive: false;
  alreadyInactive: boolean;
}

// ─── Refusals ────────────────────────────────────────────────────────────────

export const ROSTER_ERROR_CODES = [
  "invalid_body", // 400
  "unauthorized", // 401: no, invalid, expired or revoked key
  "key_not_scoped", // 403: targetApp is not RELLO
  "missing_permission", // 403
  "unknown_app", // 403: the key's appSource matches no App
  "tenant_mismatch", // 403: a tenant-bound key named another tenant
  "app_not_enabled", // 403: the calling app is not enabled for the tenant
  "actor_not_owner", // 403: actingRelloUserId is not an active owner of the tenant
  "agent_not_found", // 404
  "member_not_found", // 404
  "signature_quantity_needed", // 409: buy one more extra signature first
  "login_quantity_needed", // 409: buy one more extra login first
  "email_in_use", // 409: an agent of this tenant already has the email
  "already_member", // 409
  "email_registered_elsewhere", // 409
  "idempotency_key_reused", // 409: same requestId, different body
  "internal_error", // 500: nothing was saved; try again
] as const;
export type RosterErrorCode = (typeof ROSTER_ERROR_CODES)[number];

/** Every non-2xx body. `error` is for a person; `code` is for the caller. */
export interface RosterError {
  code: RosterErrorCode;
  error: string;
}

/** 409 signature_quantity_needed: the fix is one more `pfp-extra-signature`. */
export interface SignatureQuantityNeeded extends RosterError {
  code: "signature_quantity_needed";
  purchased: number;
  extras: number;
  addOnCatalogKey: "pfp-extra-signature";
}

/** 409 login_quantity_needed: the fix is one more `pfp-extra-team-login`. */
export interface LoginQuantityNeeded extends RosterError {
  code: "login_quantity_needed";
  included: number;
  purchased: number;
  members: number;
  addOnCatalogKey: "pfp-extra-team-login";
}
