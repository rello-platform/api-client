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
 *   GET  /api/provisioning/team-member?tenantId=&actingRelloUserId= (X2b, v2.35.0)
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

/**
 * v2.35.0: `requestId` is required. A resend is one owner action and one email: the
 * caller mints a requestId per click and keeps it until it gets an answer, so a
 * retry after a lost answer replays (200, `replayed: true`) and never sends a
 * second email. (v2.33.0 had no requestId; nothing called the route yet.)
 */
export const teamMemberSignInLinkRequestSchema = z
  .object({
    tenantId: rosterIdField("tenantId"),
    actingRelloUserId: rosterIdField("actingRelloUserId"),
    requestId: rosterRequestIdField,
  })
  .strict();
export type TeamMemberSignInLinkRequest = z.infer<typeof teamMemberSignInLinkRequestSchema>;

/** 202 when queued; 200 with `replayed: true` for the same requestId. */
export interface TeamMemberSignInLinkResponse {
  userId: string;
  signInEmail: "queued";
  replayed: boolean;
}

export const teamMemberRemoveRequestSchema = z
  .object({ tenantId: rosterIdField("tenantId"), actingRelloUserId: rosterIdField("actingRelloUserId") })
  .strict();
export type TeamMemberRemoveRequest = z.infer<typeof teamMemberRemoveRequestSchema>;

export interface TeamMemberRemoveResponse {
  userId: string;
  isActive: false;
  alreadyInactive: boolean;
}

// ─── Team logins read (D33: who has a login, and what the account pays for) ──

/** The query string of `GET /api/provisioning/team-member`. */
export const teamLoginRosterQuerySchema = z
  .object({ tenantId: rosterIdField("tenantId"), actingRelloUserId: rosterIdField("actingRelloUserId") })
  .strict();
export type TeamLoginRosterQuery = z.infer<typeof teamLoginRosterQuerySchema>;

/** One person with an active login in the account. */
export interface TeamLoginRosterMember {
  userId: string;
  /** The person's Rello Agent, or null when the login has none. */
  relloAgentId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  /** An owner role (MLO_OWNER, BROKER_OWNER, AGENT_OWNER): cannot be removed here. */
  isOwner: boolean;
}

/**
 * 200. Derived at read time; nothing is stored.
 * - `included`: the plan's logins (`Plan.maxUsers`); null = the plan sets no limit.
 * - `purchased`: the live `pfp-extra-team-login` quantity (0 with none).
 * - `capacity`: included + purchased; null when included is null.
 * - `members`: active logins now.
 * - `overBy`: members − capacity when positive, else 0. An out-of-band quantity drop
 *   (a Stripe-side or admin edit) can leave an account over; everyone keeps working,
 *   nobody is removed, and the owner adds a login or removes someone.
 */
export interface TeamLoginRosterResponse {
  included: number | null;
  purchased: number;
  capacity: number | null;
  members: number;
  overBy: number;
  addOnCatalogKey: "pfp-extra-team-login";
  people: TeamLoginRosterMember[];
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
  "cannot_remove_owner", // 409: an owner's login (yours included) is not removed through the roster (v2.35.0)
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

/** 409 already_member: the email already has a login in this account (`isActive` false = removed earlier). */
export interface AlreadyMember extends RosterError {
  code: "already_member";
  userId: string;
  isActive: boolean;
}

/** 409 login_quantity_needed: the fix is one more `pfp-extra-team-login`. */
export interface LoginQuantityNeeded extends RosterError {
  code: "login_quantity_needed";
  included: number;
  purchased: number;
  members: number;
  addOnCatalogKey: "pfp-extra-team-login";
}

// ─── Answer schemas (v2.37.0, PFP O-6) ──────────────────────────────────────
//
// v2.36.0 shipped the answers above as TypeScript types only, so a caller
// could not check at runtime that Rello's body is the shape it relies on. Each
// schema below parses the body Rello's route serves (src/app/api/provisioning/
// loginless-agent/** and team-member/** on Rello main) and is checked against
// its interface with `satisfies`, so the two can never drift apart.
//
// Not strict: a field Rello adds later is dropped, never a refusal. Refusals
// keep extra fields (`.loose()`), e.g. email_in_use's `relloAgentId`.

/** 201 / 200 of POST /api/provisioning/loginless-agent. */
export const loginlessAgentCreateResponseSchema = z.object({
  relloAgentId: z.string().min(1),
  slug: z.string().min(1),
  email: z.string().min(1),
  replayed: z.boolean(),
}) satisfies z.ZodType<LoginlessAgentCreateResponse>;

/** 200 of POST /api/provisioning/loginless-agent/[agentId]/remove. */
export const loginlessAgentRemoveResponseSchema = z.object({
  relloAgentId: z.string().min(1),
  status: z.literal("INACTIVE"),
  alreadyInactive: z.boolean(),
}) satisfies z.ZodType<LoginlessAgentRemoveResponse>;

/** 201 / 200 of POST /api/provisioning/team-member. */
export const teamMemberCreateResponseSchema = z.object({
  userId: z.string().min(1),
  relloAgentId: z.string().min(1),
  email: z.string().min(1),
  signInEmail: z.literal("queued"),
  replayed: z.boolean(),
}) satisfies z.ZodType<TeamMemberCreateResponse>;

/** 202 / 200 of POST /api/provisioning/team-member/[userId]/sign-in-link. */
export const teamMemberSignInLinkResponseSchema = z.object({
  userId: z.string().min(1),
  signInEmail: z.literal("queued"),
  replayed: z.boolean(),
}) satisfies z.ZodType<TeamMemberSignInLinkResponse>;

/** 200 of POST /api/provisioning/team-member/[userId]/remove. */
export const teamMemberRemoveResponseSchema = z.object({
  userId: z.string().min(1),
  isActive: z.literal(false),
  alreadyInactive: z.boolean(),
}) satisfies z.ZodType<TeamMemberRemoveResponse>;

const rosterCount = z.number().int().nonnegative();

export const teamLoginRosterMemberSchema = z.object({
  userId: z.string().min(1),
  relloAgentId: z.string().min(1).nullable(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  role: z.string(),
  isOwner: z.boolean(),
}) satisfies z.ZodType<TeamLoginRosterMember>;

/** 200 of GET /api/provisioning/team-member. `included` and `capacity` are null together (the plan sets no limit). */
export const teamLoginRosterResponseSchema = z
  .object({
    included: rosterCount.nullable(),
    purchased: rosterCount,
    capacity: rosterCount.nullable(),
    members: rosterCount,
    overBy: rosterCount,
    addOnCatalogKey: z.literal("pfp-extra-team-login"),
    people: z.array(teamLoginRosterMemberSchema),
  })
  .refine((r) => (r.included === null) === (r.capacity === null), {
    message: "included and capacity are null together",
  }) satisfies z.ZodType<TeamLoginRosterResponse>;

/**
 * Every non-2xx roster body: `{ code, error, ...extra }`. `code` is a plain
 * string on the wire, so a code Rello adds later never makes an older caller
 * refuse the answer; compare it against {@link ROSTER_ERROR_CODES}
 * ({@link isRosterErrorCode}). Extra fields are kept.
 */
export const rosterErrorSchema = z
  .object({
    code: z.string().min(1),
    /** For a person. */
    error: z.string(),
  })
  .loose();
export type RosterErrorParsed = z.infer<typeof rosterErrorSchema>;

export function isRosterErrorCode(code: unknown): code is RosterErrorCode {
  return typeof code === "string" && (ROSTER_ERROR_CODES as readonly string[]).includes(code);
}

/** 409 signature_quantity_needed, exactly. */
export const signatureQuantityNeededSchema = z.object({
  code: z.literal("signature_quantity_needed"),
  error: z.string(),
  purchased: rosterCount,
  extras: rosterCount,
  addOnCatalogKey: z.literal("pfp-extra-signature"),
}) satisfies z.ZodType<SignatureQuantityNeeded>;

/** 409 already_member, exactly. */
export const alreadyMemberSchema = z.object({
  code: z.literal("already_member"),
  error: z.string(),
  userId: z.string().min(1),
  isActive: z.boolean(),
}) satisfies z.ZodType<AlreadyMember>;

/** 409 login_quantity_needed, exactly. */
export const loginQuantityNeededSchema = z.object({
  code: z.literal("login_quantity_needed"),
  error: z.string(),
  included: rosterCount,
  purchased: rosterCount,
  members: rosterCount,
  addOnCatalogKey: z.literal("pfp-extra-team-login"),
}) satisfies z.ZodType<LoginQuantityNeeded>;
