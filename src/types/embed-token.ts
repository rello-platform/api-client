/**
 * PFP Gateway P-2: the embed token and F2 (tenant app access). One contract for
 * Rello's v1 routes and their two callers, PathfinderPro and Home Scout.
 * Map MAP-P2-EMBED-TOKEN-F2-261118.md
 * (sha256 114f1378ecda0a07cf5c5ba402c9481ffd8b99ea5453465e16746d7f046d7768),
 * Platform KA prompt 1306.
 *
 * Rello mints a short-lived opaque token (`rpe_…`) so a Home Scout page can open
 * inside PathfinderPro. Home Scout never trusts the token itself: it asks Rello.
 * F2 lets Home Scout ask Rello whether PathfinderPro may act for a tenant.
 *
 *   POST /api/v1/embed-tokens                          PathfinderPro → Rello   (201 mint)
 *   POST /api/v1/embed-tokens/verify                   Home Scout → Rello      (200 verdict)
 *   GET  /api/v1/platform/tenant-app-access?tenantId=  Home Scout → Rello      (200 F2)
 *
 * Auth on every route: `Authorization: Bearer <ApiKey>` (Rello's ApiKey table,
 * targetApp RELLO). The mint's tenant comes from the key, never from the body.
 *
 * Refusals are `{ error: <code> }` with a code from {@link EMBED_TOKEN_ERRORS}.
 *
 * Module-level helpers carry an `embedToken` prefix so tsup renames nothing else
 * in the bundle.
 */
import { z } from "zod";

const embedTokenId = z.string().min(1);
const embedTokenTime = z.iso.datetime({ offset: true });

// ─── Surfaces and scopes ────────────────────────────────────────────────────

/** The Home Scout page PathfinderPro wants to embed. */
export const EMBED_SURFACES = ["identity", "rate-widget"] as const;
export type EmbedSurface = (typeof EMBED_SURFACES)[number];

/** What a token lets Home Scout show. Exactly one per surface, see {@link EMBED_SURFACE_SCOPE}. */
export const EMBED_TOKEN_SCOPES = ["hs:identity-editor", "hs:rate-widget"] as const;
export type EmbedTokenScope = (typeof EMBED_TOKEN_SCOPES)[number];

/** The scope Rello stamps on a token minted for each surface. */
export const EMBED_SURFACE_SCOPE: Readonly<Record<EmbedSurface, EmbedTokenScope>> = Object.freeze({
  identity: "hs:identity-editor",
  "rate-widget": "hs:rate-widget",
} as const);

/** Every token is minted for Home Scout and for nothing else. */
export const EMBED_TOKEN_AUDIENCE = "home-scout" as const;

/** Every token Rello mints starts with this prefix. */
export const EMBED_TOKEN_PREFIX = "rpe_" as const;

const embedTokenScope = z.enum(EMBED_TOKEN_SCOPES);

// ─── Mint ───────────────────────────────────────────────────────────────────

/** Body of `POST /api/v1/embed-tokens` (PathfinderPro → Rello). Strict: the tenant comes from the key. */
export const embedTokenMintRequestSchema = z
  .object({
    agentId: embedTokenId,
    surface: z.enum(EMBED_SURFACES),
  })
  .strict();
export type EmbedTokenMintRequest = z.infer<typeof embedTokenMintRequestSchema>;

/**
 * 201 of the mint. `token` is opaque: a consumer passes it on and never reads
 * meaning into it beyond the `rpe_` prefix. `scope` is
 * `EMBED_SURFACE_SCOPE[request.surface]`.
 */
export const embedTokenMintResponseSchema = z
  .object({
    token: z.string().startsWith(EMBED_TOKEN_PREFIX).min(EMBED_TOKEN_PREFIX.length + 1),
    /** ISO-8601. */
    expiresAt: embedTokenTime,
    audience: z.literal(EMBED_TOKEN_AUDIENCE),
    scope: embedTokenScope,
    tenantId: embedTokenId,
    agentId: embedTokenId,
  })
  .strict();
export type EmbedTokenMintResponse = z.infer<typeof embedTokenMintResponseSchema>;

// ─── Verify ─────────────────────────────────────────────────────────────────

/** Body of `POST /api/v1/embed-tokens/verify` (Home Scout → Rello). */
export const embedTokenVerifyRequestSchema = z
  .object({
    token: z.string().min(1),
  })
  .strict();
export type EmbedTokenVerifyRequest = z.infer<typeof embedTokenVerifyRequestSchema>;

/** Why Rello says a token is not valid. Each one is a definite answer from Rello. */
export const EMBED_TOKEN_INVALID_REASONS = ["expired", "revoked", "unknown_token"] as const;
export type EmbedTokenInvalidReason = (typeof EMBED_TOKEN_INVALID_REASONS)[number];

export const embedTokenVerifyValidSchema = z
  .object({
    valid: z.literal(true),
    tenantId: embedTokenId,
    agentId: embedTokenId,
    scope: embedTokenScope,
    /** ISO-8601. */
    expiresAt: embedTokenTime,
  })
  .strict();
export type EmbedTokenVerifyValid = z.infer<typeof embedTokenVerifyValidSchema>;

export const embedTokenVerifyInvalidSchema = z
  .object({
    valid: z.literal(false),
    reason: z.enum(EMBED_TOKEN_INVALID_REASONS),
  })
  .strict();
export type EmbedTokenVerifyInvalid = z.infer<typeof embedTokenVerifyInvalidSchema>;

/**
 * 200 of the verify, a union on `valid`.
 *
 * ⚑ UNKNOWN IS NOT INVALID. Rello answers 503 `embed_token_unavailable` (no body
 * schema) when it cannot tell. A consumer MUST treat a 503, a timeout, a network
 * error, any other non-200, or a 200 body this schema refuses as UNKNOWN: never
 * as `valid: false` (that would tell the MLO a good token was revoked) and never
 * as valid. Only a body this schema accepts is a verdict.
 */
export const embedTokenVerifyResponseSchema = z.discriminatedUnion("valid", [
  embedTokenVerifyValidSchema,
  embedTokenVerifyInvalidSchema,
]);
export type EmbedTokenVerifyResponse = z.infer<typeof embedTokenVerifyResponseSchema>;

// ─── F2: tenant app access ──────────────────────────────────────────────────

/**
 * 200 of `GET /api/v1/platform/tenant-app-access?tenantId=` (Home Scout → Rello):
 * whether PathfinderPro may act for this tenant. A 503
 * `tenant_app_access_unavailable` is UNKNOWN, never `servable: false`.
 */
export const tenantAppAccessResponseSchema = z
  .object({
    tenantId: embedTokenId,
    servable: z.boolean(),
  })
  .strict();
export type TenantAppAccessResponse = z.infer<typeof tenantAppAccessResponseSchema>;

// ─── Errors ─────────────────────────────────────────────────────────────────

/**
 * The `error` codes these routes answer in a `{ error: <code> }` body (beside
 * the shared v1 auth refusals, below). Statuses in {@link EMBED_TOKEN_ERROR_STATUS}.
 *
 *  400 UNKNOWN_FIELD                  a body (or F2 query) key the route does not
 *                                     take; the body also carries `field`, the key
 *                                     ({ error: "UNKNOWN_FIELD", field: "tenantId" })
 *  400 invalid_body                   a body that is not JSON, not an object, or has
 *                                     a bad value; the body also carries `message`
 *                                     ({ error: "invalid_body", message: "..." })
 *  404 agent_not_in_tenant            the mint's agentId is not this tenant's
 *  409 agent_inactive                 the agent exists but is not active
 *  409 home_scout_not_enabled         the tenant has no Home Scout
 *  409 tenant_not_servable            PathfinderPro may not act for this tenant
 *  503 embed_token_unavailable        mint or verify could not tell: UNKNOWN
 *  503 tenant_app_access_unavailable  F2 could not tell: UNKNOWN (a failed ApiKey
 *                                     read in the auth chain answers these 503s too)
 *
 * NOT in this map — the shared v1 auth refusals, answered before the route
 * reads anything (every one with Cache-Control: no-store):
 *  401 { error: "Unauthorized" }                     no valid ApiKey
 *  403 { error: "Forbidden" }                        the key lacks the route's permission
 *  403 { error: "Forbidden — caller app not allowed" }
 *                                                    mint: not pathfinder-pro;
 *                                                    verify / F2: not home-scout
 *  403 { error: "Forbidden — tenant header does not match credential" }
 *  403 { error: "Forbidden — app 'pathfinder-pro' is not enabled for tenant" }
 *                                                    mint only (the tenant binding)
 *  429 per-app rate limit, with Retry-After          mint only (requireV1Auth)
 */
export const EMBED_TOKEN_ERRORS = Object.freeze({
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
  INVALID_BODY: "invalid_body",
  AGENT_NOT_IN_TENANT: "agent_not_in_tenant",
  AGENT_INACTIVE: "agent_inactive",
  HOME_SCOUT_NOT_ENABLED: "home_scout_not_enabled",
  TENANT_NOT_SERVABLE: "tenant_not_servable",
  EMBED_TOKEN_UNAVAILABLE: "embed_token_unavailable",
  TENANT_APP_ACCESS_UNAVAILABLE: "tenant_app_access_unavailable",
} as const);
export type EmbedTokenErrorCode = (typeof EMBED_TOKEN_ERRORS)[keyof typeof EMBED_TOKEN_ERRORS];

/** The HTTP status Rello answers with each {@link EMBED_TOKEN_ERRORS} code. */
export const EMBED_TOKEN_ERROR_STATUS: Readonly<Record<EmbedTokenErrorCode, 400 | 404 | 409 | 503>> = Object.freeze({
  UNKNOWN_FIELD: 400,
  invalid_body: 400,
  agent_not_in_tenant: 404,
  agent_inactive: 409,
  home_scout_not_enabled: 409,
  tenant_not_servable: 409,
  embed_token_unavailable: 503,
  tenant_app_access_unavailable: 503,
} as const);

// ─── postMessage types (Home Scout iframe ↔ PathfinderPro host) ─────────────

/** Home Scout asks the PFP host for a fresh token before the current one expires. */
export const EMBED_TOKEN_REFRESH_MESSAGE = "pfp-embed:token-refresh" as const;
/** The PFP host hands Home Scout a freshly minted token. */
export const EMBED_TOKEN_MESSAGE = "pfp-embed:token" as const;
/** The existing PFP message: the embedded session has expired. */
export const EMBED_SESSION_EXPIRED_MESSAGE = "pfp-embed:session-expired" as const;
