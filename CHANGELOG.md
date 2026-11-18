# Changelog

Version rule for api-client #10 (`createWithOutcome`): its branch still says
2.29.0, but #10 takes the next free version when it merges (2.33.0 after
v2.32.0), built on top of main, so its tag contains every earlier release.
(Replaces the v2.31.0 note that 2.29.0 belonged to #10 alone; GD-1661,
AUDIT 99.)

## v2.37.0 — 2026-11-17

### Added — Rello's tenant-bound v1 billing reads, the add-on start, and zod for the v2.36.0 answers (PFP Gateway P-1)

Platform KA prompt 1221, rulings 1247 / 1248 / 1261; spec SPEC-PFP-GATEWAY.md
§4.2 / §4.3. Rello side: P-1's PR (requireV1TenantMatch, GET
/api/v1/billing/plan-grants, GET /api/v1/billing/add-ons). Version read at
2026-11-17: v2.36.0 tagged (#17), no open PR claims v2.37.0 (#10 takes the
next free version when it merges).

- `src/types/v1-billing-reads.ts`, one contract for Rello's routes and
  PathfinderPro's callers:
  - The §4.2 tenant 403 texts: `V1_TENANT_MATCH_ERRORS`,
    `appNotEnabledForTenantError(slug)`, `v1TenantMatchErrorSchema`.
  - Plan-grants read: `planGrantsReadResponseSchema` { rev, grants, planSlug,
    cyr }. `cyr` is REQUIRED and nullable (the tenant's effective Check Your
    Rate record, the `tenantCyrStateSchema` shape; null = never held; a body
    without the key is refused, A-286). `canceledAt` is null on this read,
    CANCELED included (ruling 1261): use `occurredAt` as the cancel time.
    `PLAN_GRANTS_READ_ERROR_CODES` (404 `no_plan_grants`, 503
    `plan_grants_unavailable`).
  - Add-ons read: `v1AddOnsReadResponseSchema` — the caller's add-ons with
    `price` { monthly, yearly } in integer cents (null = unknown, never $0; a
    determined 0 is a real 0) and this tenant's `tenantAddOn` or null, whose
    `quantityRev` is a decimal string (a BIGINT). `ADD_ONS_READ_ERROR_CODES`
    (503 `add_ons_unavailable`). Needs `billing:read` granted to pathfinder-pro
    and carried on PFP's key before PFP can call it.
  - The add-on start (R1, as served at Rello 0ae41a132):
    `addOnStartRequestSchema` (strict: addOnId, quantity?, trial?,
    quantityRev? as an integer or a 1–18 digit string),
    `ADD_ON_START_IDEMPOTENCY_HEADER` ("X-Idempotency-Key"),
    `addOnStartResponseSchema` ({ success: true, data: { tenantAddOnId,
    status, trialEndsAt? } }), `addOnStartErrorSchema` (`.loose()`, so a code's
    fields like `needsPaymentMethod` / `coveredSeats` are kept) and
    `ADD_ON_START_ERROR_CODES` (R1's ten, with `addon_price_not_configured`
    the 409 for a missing TEAM/DEFAULT price, carrying `family`, `interval`
    and `addOnId`; see GD-2250 below).
  - GD-2250 (AUDIT 111, KA 1325): the list named `addon_pricing_not_configured`
    and omitted `addon_price_not_configured`, the code Rello main sends
    (`src/lib/billing/cyr-price.ts`, forwarded by `POST /api/v1/billing/add-on`).
    The list now names `addon_price_not_configured`. `addon_pricing_not_configured`
    is removed: at Rello origin/main a8cf79a8e (contains b654fdafe) nothing
    sends it; its only occurrence is a comment in
    `src/lib/billing/v1/add-on-unit-price.ts`. The list was introduced in this
    unreleased version, so v2.36.0 callers lose nothing. `code` stays an open
    string, so a body carrying the old spelling still parses.
- Zod for the answers v2.36.0 shipped as types only:
  - Roster (`src/types/roster.ts`): the six answers, `rosterErrorSchema`
    (`code` a plain string, `.loose()`), `isRosterErrorCode`, and the three
    exact refusals.
  - Plan switch (`src/types/billing-switch.ts`): preview, applied / open
    (discriminated on `status`), operation, `switch_in_progress`, the other
    refusals, and `planSwitchErrorSchema`.
  - 409 `members_exceed_target`: `{ error: "members_exceed_target",
    activeMembers, targetLimit, message? }`, strict, non-negative integers —
    the plan-switch envelope with X1's counts (ruling 1248 Q2).
  - `planSwitchErrorSchema` parses a dedicated code only through its own
    schema (AUDIT 111 GD-2146, KA 1275). `planSwitchOtherErrorSchema`, the open
    branch, refuses `members_exceed_target`, `preview_stale` and
    `switch_in_progress` (`PLAN_SWITCH_DEDICATED_ERROR_CODES`), so a malformed
    one is refused rather than accepted. Every other code parses there,
    including a future one.

### Changed — `PlanSwitchError` (type only; no known consumer)

- `PlanSwitchError`'s `members_exceed_target` branch now requires
  `activeMembers` and `targetLimit`: the envelope ruled in 1248. In v2.36.0 it
  was part of the generic `{ error, message? }` branch. A value assigned as
  `{ error: "members_exceed_target", message }` with no counts no longer
  compiles (AUDIT 111 GD-2147).
- KA compatibility exception (1275): the KA checked every app's origin/main for
  `PlanSwitchError` outside tests and found 0 consumers.
- Every schema is `satisfies z.ZodType<Interface>`, so it can't drift from its
  type.

Tests, red on v2.36.0's dist (16 of 16) and green on this one (plus
`tests/gd2146-plan-switch-error-family.test.mjs`: the auditor's five malformed
bodies are refused, and well-formed, non-dedicated and future codes still
parse; red 3 of 4 on the first v2.37.0 head):
- `tests/p1-v1-billing-served.test.mjs` parses Rello's REAL served bodies
  (`tests/fixtures/rello-v1-billing-served-dd8e6c00c.json`, captured from
  Rello's own route tests on real Postgres). It covers plan-grants 200s in
  every cyr status, the refusals, the 403s, the add-ons read, and the start's
  200s and refusals.
- `tests/p1-v1-billing-reads-zod.test.mjs` covers the roster against
  `tests/fixtures/rello-roster-served-c4fceb59e.json` (real bodies). Its
  plan-switch fixtures are HAND-WRITTEN, because no Rello route serves plan
  switch yet.

## v2.36.0 — 2026-11-16

### Added — the G-10R + G-EXTRAS contract: plan switch and add-on quantity (PFP Gateway PKG-2)

Plan a7-1147 §F/§H/§P (AUDIT 106 CLEAR WITH FOLLOW-UPS, KA ruling 1163),
spec SPEC-PFP-GATEWAY.md G-10R (D47, K-248, H-172), Platform KA prompt 1199.
One contract for Rello's v1 billing routes and PathfinderPro's callers:
`src/types/billing-switch.ts`. Version read at 2026-11-16T23:24:48Z: v2.35.0
tagged (#15), no open PR claims v2.36.0 (#10 takes the next free version when
it merges, per the rule above).

- Preview: `planSwitchPreviewQuerySchema` (strict; `targetPlanSlug`, optional
  `interval`) and `PlanSwitchPreviewResponse` with `previewId`, `expiresAt`,
  `prorationDate`, `requiresConfirmation`, per-subscription lines and
  `chargeChange`.
- POST: `planSwitchRequestSchema` (strict: no tenant, no D47 options) with
  `previewId` and `confirmedChargeChange`. The latter parses as `unknown` on
  purpose: a non-boolean reaches switchPlan()'s `=== true` check and answers
  `confirmation_required`, never `invalid_body`. Callers type the body as
  `PlanSwitchRequest` (`confirmedChargeChange?: true`). Responses: 200 APPLIED,
  202 OPEN, and the operation GET.
- `PLAN_SWITCH_ERROR_CODES` (18): `confirmation_required`, `preview_stale`,
  `preview_consumed`, `use_plan_switch`, `stale_switch`, `switch_in_progress`,
  `not_armed`, `provider_unreadable`, … ; `PREVIEW_STALE_REASONS`
  (`inputs_changed` | `provider_changed` | `expired`) and
  `previewStaleErrorSchema`, whose `reason` is optional and a plain string on
  the wire, so a later reason never makes an older PFP refuse the answer.
- `tenantEnablePayloadSchema.addOns`: an optional array of add-on state
  records (the `cyr` shape), one per feature. Absent = an older Rello; none = [].
- Add-on quantity PATCH (R1's route, generalized by X1), typed exactly as R1
  serves it (#2381 @ 8afad20dc5; fix round 1202, AUDIT 106 GD-1971..1973):
  - `addOnQuantityRequestSchema` (strict; `quantity` ≥ 0, `quantityRev` a
    non-negative number or a digit string). The key travels in the
    `X-Idempotency-Key` header, 8–128 characters
    (`ADDON_QUANTITY_IDEMPOTENCY_HEADER`, `ADDON_QUANTITY_IDEMPOTENCY_KEY_LENGTH`).
  - `addOnQuantityResponseSchema` / `AddOnQuantityResponse`: R1's five fields
    (`tenantAddOnId`, `quantity`, `quantityRev` as a string, `billedQuantity`,
    `superseded`); `status` and `subscriptionCanceled` are optional, added by X1.
  - `ADDON_QUANTITY_ERROR_CODES` (12 domain codes) and
    `ADDON_QUANTITY_IDEMPOTENCY_ERROR_CODES` (`IDEMPOTENCY_KEY_REQUIRED`,
    `_INVALID`, `_CONFLICT`).
  - `addOnQuantityErrorSchema` / `AddOnQuantityError` parse every refusal the
    route gives, including the codeless ones (`{ success: false, error }` for
    400 invalid body, 404, 403, 500, 503; `{ error }` from the auth and
    tenant-app guards) and an unknown later code; extra fields are kept. The
    exact domain branches: `extraMlosExceedQuantityErrorSchema`
    (`{ activeLoginless, quantity }`) and `membersExceedQuantityErrorSchema`
    (`{ activeMembers, quantity }`), narrowed with
    `isExtraMlosExceedQuantityError` / `isMembersExceedQuantityError`.
  The envelope is R1's: `{ success: false, error: <message>, code, ...extra }`.

Tests: tests/pkg2-plan-switch-addon-quantity.test.mjs, red 8/8 on the v2.35.0
dist, green after compile; 10 mutants, each killed by a named test.
Fix round (prompt 1202): tests/pkg2-addon-quantity-wire-1202.test.mjs and
tests/types/pkg2-addon-quantity-wire.fixture.ts, red 6/6 at ddc94cde2, green
after; 4 mutants (one or two per finding), each killed.

## v2.35.0 — 2026-11-16

Rebased onto v2.34.0 (#16, the G-SETUP + G-A2P contract, Platform KA prompt
1197). It contains every earlier release, and #16's exports and types are unchanged.

### Added / changed — the X2b team-member contract (PFP Gateway X2b, D33)

Platform KA prompt 1171 (plan a4-1151 ruled: "keep everyone working, derive
'over by N' on read, one AdminNotification, never auto-deactivate or delete").

- `teamMemberSignInLinkRequestSchema` now requires `requestId` (8–200 chars).
  A resend is one owner click and one email: a retry after a lost answer
  replays with the same requestId and sends nothing more. BREAKING against
  v2.33.0's shape, which nothing called yet (PathfinderPro's caller is not built).
- `TeamMemberSignInLinkResponse` `{ userId, signInEmail: "queued", replayed }`.
- `GET /api/provisioning/team-member` — the logins read:
  `teamLoginRosterQuerySchema` `{ tenantId, actingRelloUserId }` (strict), and
  `TeamLoginRosterResponse` `{ included, purchased, capacity, members, overBy,
  addOnCatalogKey: "pfp-extra-team-login", people }` with
  `TeamLoginRosterMember` rows. Everything is derived when read; nothing is stored.
- `ROSTER_ERROR_CODES` gains `cannot_remove_owner` (409): an owner's login is not
  removed through the roster route.
- `AlreadyMember` `{ code: "already_member", userId, isActive }`.

## v2.34.0 — 2026-11-16

### Added — the G-SETUP + G-A2P contract: setup charge and texting registration (PFP Gateway)

Plan a6-1143 §D (Platform KA prompts 1143 / 1160 / 1172), spec
SPEC-PFP-GATEWAY.md rev 10.31 §4.12d item 6, the Platform KA's 2044Z contract
pins, H-173, GD-1761 and GD-1763. One contract for Rello's routes and
PathfinderPro's callers and receivers: `src/types/sms-setup.ts`.

- Charge lane: `setupChargeRequest` (strict, no amount, `quoteVersion`
  required), `setupChargeStatus` (7 values incl. `voided`),
  `setupChargeEnvelope`, `chargeConflict`.
- The fee GET (`GET /api/provisioning/setup-charge/fee`) is contract:
  `feeSlugQuery` (the tenant comes from the key, never a parameter),
  `oneTimeFeeQuote` (with `quoteVersion`), `feeNotFound`, `internalError`
  (`requestId` required).
- H-173: `quoteVersion` on the quote and on the POST body;
  `feeChangedConflict` = `409 { error: "fee_changed", quote }` with the CURRENT
  quote (also when `isActive: false`). It replaces `fee_inactive`.
- GD-1763: `business_suspension_final` is a code in both `chargeConflict` and
  `registrationConflict`, with that lane's envelope or `null` when the MLO has
  no row in it (POST sms-registration, POST setup-charge, POST …/otp). No new
  wire status: waiting MLOs read `rejected`, then `refunded`.
- Registration lane: `smsRegistrationRequest` (strict; `attachToBusiness` and
  any other unknown key are refused; a bare 2nd+ MLO STANDARD body parses and the
  route decides CREATE 400 field `business` / ATTACH server-side; the business
  pair travels together; an LLC as a sole proprietor names `brandType`),
  `smsOtpRequest`, `smsRegistrationStatus` (13 values incl. `number_pending`
  and `suspended`; a LIVE MLO on a suspended business displays `suspended` with
  `phoneNumber: null`), `smsRegistrationEnvelope`, `registrationConflict`,
  `businessType`, `businessIndustry`.
- GD-1761: an ambiguous provider create has no wire status.
- Events: `setupChargeChangedEvent` (`billing.setup_charge_changed`) and
  `smsRegistrationChangedEvent` (`sms.registration_changed`).
- Rello's admin bodies (§D.3) are Rello-internal and are not exported.

### Changed — the package's own `@rello-platform/permissions` re-pinned v0.60.0 → v0.62.0

Additive only (+3 slugs, none removed): `billing:setup-charge:write` and
`sms:registration:write` (v0.61.0), `billing:plan-switch:write` (v0.62.0).
`createServiceBearerGuard` / `callerHasPermission` are typed against this
package's own copy, which npm nests under api-client, so a consumer's newer pin
does not reach the guard's union (the v2.32.0 lesson). No billing-client bump.

Version: v2.34.0 was free when this opened (latest tag v2.33.0; open PR #10
still names 2.29.0 and takes the next free number when it merges). Whichever
PR merges second re-versions.

Test: `tests/g-a2p-setup-charge-sms-registration.test.mjs` (12 tests). Red at
v2.33.0 (11 of 12 fail; the 12th asserts the admin bodies are NOT exported),
green here. Mutants, each red then restored: `quoteVersion` dropped from the
POST body; `attachToBusiness` let through; `fee_changed`'s `quote` made optional.

## v2.33.0 — 2026-11-15

### Added — `loginless` on the provisioned agent, and the X2 roster route contract (PFP Gateway X2)

Spec SPEC-PFP-GATEWAY.md rev 10.30 §6 "[D30] Extra-signature MLOs", G-EXTRAS and
D33; Platform KA prompts 1152/1153/1155 (plan a4-1151 ruled).

- `provisionedAgentSchema.loginless`: an optional boolean. `true` marks a D30
  extra-signature loan officer, a Rello Agent that never has a login. Rello
  sends it on every tenant-enable push, true or false. An absent key (an older
  Rello) is UNKNOWN, never "has a login". The schema is a plain `z.object`, which
  strips unknown keys, and Rello sends the parsed payload, so at v2.32.0 the
  flag never reached the wire. The per-agent push carries the same field through
  `@rello-platform/agent-provisioning` v0.10.0.
- `src/types/roster.ts`: request schemas (strict), answers and the closed
  `ROSTER_ERROR_CODES` list for
  - `POST /api/provisioning/loginless-agent` and `.../[agentId]/remove` (X2a);
  - `POST /api/provisioning/team-member`, `.../[userId]/sign-in-link` and
    `.../[userId]/remove` (X2b).

  The two quantity refusals carry their fix: `signature_quantity_needed` names
  `pfp-extra-signature`, and `login_quantity_needed` names `pfp-extra-team-login`.

Version: v2.33.0 was free when this opened (latest tag v2.32.0; open PR #10
still names 2.29.0 and takes the next free number when it merges). Agent 7's
PKG-2 and Agent 6's G-A2P also planned v2.33.0 and take the next free one.
The package's own permissions pin stays v0.60.0: the X2 routes are validated
by Rello's ApiKey table, not by `createServiceBearerGuard`.

Test: `tests/x2-roster-loginless.test.mjs` (4 tests). Red at v2.32.0 (4 of 4
fail), green here. Mutant: `loginless` dropped from `provisionedAgentSchema` →
the tenant-enable test fails; restored byte-for-byte.

## v2.32.0 — 2026-11-14

### Changed — the package's own `@rello-platform/permissions` re-pinned v0.54.0 → v0.60.0

`createServiceBearerGuard`, `callerHasPermission` and `PlatformCaller` are
typed against `PermissionSlug` from api-client's OWN dependency. At v2.31.0
that was permissions v0.54.0, so a consumer route passing a newer slug failed
tsc even after the consumer bumped its top-level permissions: npm nests the
older copy under api-client and the guard keeps its union. Home Scout's
`POST /api/internal/rate-check/price` passing `"rate-check:price"`
(permissions v0.60.0; PFP Gateway G-RC, spec rev 10.20 §4.12d item 4) hit
TS2322 (Platform AUDIT 99, prompt 1118).

The pin is now `github:rello-platform/permissions#v0.60.0` (resolved
`2a2b0159`), so the guard's union includes `rate-check:price`,
`agents:contact:write` (v0.59.0) and `billing:plan-grants:read` (v0.58.0).
Runtime behaviour is unchanged: the guard still refuses a key without the
required permission (403 `PERMISSION_DENIED`). A consumer typing a permission
must keep its own permissions pin at or above this one.

Test: `tests/permissions-repin-rate-check-price.test.mjs` type-checks
`tests/types/rate-check-price.fixture.ts` against the built `dist/` with the
TypeScript API (red at v2.31.0: TS2322 and TS2345), plus a runtime refusal and
a runtime pass for `rate-check:price`.

## v2.31.0 — 2026-11-14

### Added — per-agent link and owner flags on the provisioned agent (PFP Gateway G-6a-pre)

`provisionedAgentSchema` is a plain `z.object`, which strips unknown keys,
and Rello sends the parsed payload, so it could not tell a spoke whether an
agent can own leads or which agent owns the tenant. Two optional booleans:

- `hasLinkedUser: boolean`: the Rello Agent has a linked User. Home Scout's
  page editor uses it to tell an owner a loan officer needs a Rello login
  before their page can own leads (a setup message, never a hold).
- `isTenantOwner: boolean`: the agent's linked User holds an owner role.
  PathfinderPro uses it to set the account's shared rate source at write time.

### Changed — `planGrants.planSlug` may be null (KA ruling G-15)

A cancelled tenant's plan-grant state is `grants: []` with `planSlug: null`.
At v2.30.0 `planSlug` was `z.string()`, so Rello's push parse would refuse the
whole enable body. It is now `z.string().nullable()` and stays a required key.
A string `planSlug` parses exactly as before; the inferred type gains `| null`.

### Added — optional `cause` on `planGrants` and on the `cyr` block (KA amendment 1109)

`tenantPlanGrantsSchema` and `tenantCyrStateSchema` each gain
`cause: z.string().optional()`. `"plan_change"` means the grant set (or Check
Your Rate record) changed because of a plan switch; absent means any other
change. Read it as `cause === "plan_change"`, never as "present", because the
cyr block's source event, `billing.addon_changed`, may carry other cause values.
It is a plain string, not an enum, so a later value never makes an older
receiver refuse the push. At v2.30.0 `cause` was dropped from the cyr block, as
GD-1582 recorded; it is now kept. `previousStatus`, `addOnId` and
`tenantAddOnId` are still accepted and dropped. A body without `cause` parses
exactly as at v2.30.0.

### Notes on the agent flags

Both are optional: absent means the sender did not say (never false), and a
payload without them parses exactly as at v2.30.0. The schema still strips
any key it does not name. The fields ride on `agentProvisionPayloadSchema`
too, since it shares the agent schema; Rello does not send them there.

## v2.30.0 — 2026-11-13

Version note: api-client #10 (`createWithOutcome`) also claimed 2.29.0; this
release is 2.30.0 whatever the merge order (Platform KA ruling, 1087), so
2.29.0 belongs to #10 alone.

### Added — gateway fields on the tenant enable payload (PFP Gateway G-2, §4.2)

`tenantEnablePayloadSchema` stripped unknown keys, so Rello could not send
PFP the gateway state it needs at tenant create. Three optional fields:

- `tenant.billingOrigin: string | null`: `"pfp-gateway"` for a tenant a PFP
  gateway checkout created, null otherwise.
- `planGrants: { rev, grants, planSlug } | null` (`tenantPlanGrantsSchema`,
  type `TenantPlanGrants`). `rev` is a non-negative integer, `grants` is plain
  strings (feature slugs from `@rello-platform/slugs` `FEATURE_SLUGS`, kept
  as strings so an older slugs release still parses a newer feature).
- `cyr: { featureSlug, status, quantity, trialEndsAt, canceledAt, occurredAt, seq, source } | null`
  (`tenantCyrStateSchema`, type `TenantCyrState`): the effective Check Your
  Rate record, the eight named fields of `billing.addon_changed` (§4.3 rule 3).
  `featureSlug` is a non-empty string. The schema is not strict: the event's
  other keys (`previousStatus`, `addOnId`, `tenantAddOnId`, `cause`) are
  accepted and dropped.

All are optional, so a payload from an older sender parses as before.

### Changed — `phone` and `tenant.logoUrl` may be absent (A-195)

Rello's enable push now omits an empty agent phone and an empty tenant logo
instead of sending null. The schema accepts absent, null or a string for
both. Parsing is strictly more permissive. The inferred type gains `?` on
the two keys: a consumer that compared them `=== null` should treat
`undefined` the same.

## v2.28.1 — 2026-09-29

### Fixed — the key validator fails closed only on 401/403 (ruling D-83)

`createPlatformKeyValidator` failed closed on **any** 4xx from the
service-keys refresh, discarding a good key cache. At 2026-09-29T15:30:07Z a
single edge 409 on Milo's refresh (the request never reached Rello's app,
which logged no 4xx) made Milo refuse every inbound platform token for 5
minutes: 165 refusals, 1 scheduled decision and 1 compose-now lost.

- **401 / 403** → fail closed, as before. They are the only answers about our
  credential; serving past them would mask credential drift.
  `lastFetchStatus = "auth-refused"`.
- **Any other 4xx** (409, 404, 429, 400, …) → stale-serve within the existing
  `cacheTtlMs + staleServeMaxMs` cap, exactly like a 5xx.
  `lastFetchStatus = "4xx-other"`, a value it shares with neither `5xx` nor
  `auth-refused`.
- No cache yet → still fail closed, whatever the status.
- The stale-serve and cap warnings now name the real status:
  `reason=upstream-4xx-other status=409`.

### Added — `validator.reasonFor(request)`: why a call returned null

Until now all six null returns were the same bare `null`, so a consumer could
not tell "no key matched this token" from "the validator refused every token".
Milo logged "did not match any active key" through the 2026-09-29 refusal
episode, when the token did match the cached key.

`createPlatformKeyValidator` now returns a `PlatformKeyValidator`: the same
callable, plus `reasonFor(request)` →
`{ reason: "no-bearer" | "no-key-match" | "auth-refused" | "no-cache" | "stale-cap-exceeded", httpStatus }`,
or `undefined` when that request got a caller or was never validated. It is
keyed by the Request object (a WeakMap), so concurrent requests never read each
other's reason, and it never changes what the call returns. New exported
types: `PlatformKeyValidator`, `ValidatorNullReason`, `ValidatorNullReport`.

Additive and source-compatible: the returned value is still assignable to
`(request: Request) => Promise<PlatformCaller | null>`. Consumers need only the
pin bump; reading the reason is opt-in.

## v2.18.0 — 2026-05-13

### Added — `ServiceClient.propertyAutofill()` for SPEC-PE-PFP-PROPERTY-AUTOFILL

Adds one method on `ServiceClient` mirroring the existing `addressNormalize`
precedent verbatim. Un-gates PFP-side consumption of
`POST /api/property-autofill` (PE Phase 1 shipped at PE SHA `b2b8e0b`
2026-05-13).

#### New method

```ts
async propertyAutofill(
  input: PropertyAutofillRequest,
  tenantId: string,
): Promise<PropertyAutofillResponse>
```

Unified composer endpoint that wraps address-normalize + Parcel resolution +
MLS listing lookup + (optional) ATTOM enrichment behind one call. Eliminates
2-3 sequential round-trips for cross-app callers (PFP Cockpit Section 2,
future spokes).

`tenantId` is REQUIRED — Property Engine returns 400 if the `X-Tenant-Id`
header is absent. Property data (Parcel + listing + ATTOM) is platform-shared
/ external-keyed; `tenantId` exists for the audit trail dimension and to pass
the receiver's auth gate (`lookups:read` permission).

#### New type exports

- `PROPERTY_AUTOFILL_FIELD_KEYS` const array (9 caller-declarable fields)
- `PropertyAutofillFieldKey` union
- `PropertyAutofillFreeFormInput` / `PropertyAutofillPreSplitInput` /
  `PropertyAutofillRequest`
- `PropertyAutofillPropertyStatus` / `PropertyAutofillPropertyType` (Prisma
  enum mirrors — inlined as string-literal unions; no `@prisma/client`
  dependency)
- `PropertyAutofillListing` / `PropertyAutofillFieldShape` /
  `PropertyAutofillAttomSummary`
- `PropertyAutofillResponseSuccess` / `PropertyAutofillResponseError` /
  `PropertyAutofillResponse`

Type contract sourced verbatim from PE
`src/app/api/property-autofill/route.ts` at SHA `b2b8e0b` lines 63-187.
Prisma enum mirrors source from PE `prisma/schema.prisma:1059-1084`.

#### TRID guardrail (Design Call #2 lock)

Response describes the borrower's CURRENT RESIDENCE only — never implies
subject-property speculation. Consumers MUST NOT wire this to subject-
property intake. PFP's TRID stance is that subject-property addresses are
never captured pre-LOS-export.

### Provenance

SPEC-PE-PFP-PROPERTY-AUTOFILL Design Call #4 LOCKED. T4-PE Phase 1
close-report (2026-05-13) deferred 200 happy-path smoke to Phase 2;
this release un-gates PFP-side consumer-pin work.

Consumer pin bumps (PFP / Scout / Drumbeat / MarketIntel / Rello) fan out
as separate per-consumer dispatches per `feedback-shared-file-wave-build-gate`.

## v2.15.0 — 2026-05-12

### Added — `LeadsResource.getClosedLoans` for HHUB Phase 7 ClosingTransaction read path

`LeadsResource.getClosedLoans(tenantId, id)` exposes Rello's
`GET /api/leads/:id/closed-loans` endpoint (non-v1 route — uses
`transport.getRaw` with the `/api` prefix). Server filters by
`status: "CLOSING_COMPLETED"`, orders by `closedAt` desc with
`actualClosingDate` desc fallback, and returns the Hub-rendered field
projection. Method returns `ClosedLoan[] | null` — null when no
closed-loan row exists for the lead.

First consumer: HS Hub data-assembly `fetchMortgageBlock` per HHUB B-04
amended two-source mortgage lock. ClosingTransaction is the highest-
fidelity mortgage source (real ARIVE LOS data); Flueid `hh_lien1_*`
customFields remain the secondary public-records fallback.

#### New export

```ts
export interface ClosedLoan {
  id: string;
  lender: string | null;
  originalBalance: number | null;
  currentBalance: number | null;
  rate: number | null;
  termMonths: number | null;
  monthsRemaining: number | null;
  closedAt: string | null;
  propertyAddress: string;
}
```

`closedAt` falls back to `actualClosingDate` server-side during the
ARIVE writer dual-populate transition window (Lock S-2). Both are
ISO-8601 strings.

### Provenance

Closes HHUB Phase 7 ClosingTransaction read path. The Rello endpoint
`GET /api/leads/:id/closed-loans` was shipped on Rello origin/main
prior to this release; this version exposes a typed client for spokes.
HS is the first consumer; future consumers per HHUB B-04 may include
Milo composition + Oven CTA selector. ARIVE writer extension to
populate the columns is an out-of-scope follow-up — at release time
the prod `ClosingTransaction` table has 0 rows total, so this method
returns null for every existing lead until ARIVE writeback ships.

## v2.11.0 — 2026-05-08

### Added — `createPlatformKeyValidator` stale-serve fallback for upstream 5xx resilience

`createPlatformKeyValidator` now serves last-good cache when the upstream
`Rello /api/v1/platform/service-keys` endpoint returns 5xx, has a network error,
or times out — capped at `cacheTtlMs + staleServeMaxMs` of staleness from the
last successful fetch.

Before v2.11.0, every spoke that adopted the validator hard-rejected 100% of
inbound `Bearer` calls for the duration of any Rello deploy storm or DB blip.
The 84-min Property-Engine outage 2026-05-08 13:54–15:18 MDT (PE deployment
`4eb17054-4052-4aaa-bee2-1fb822e07922`) demonstrated the platform-wide blast
radius — every adopting spoke (PE, CE, JE, NS, Drumbeat, Home Scout, Oven,
Harvest Home, HomeReady, TheHomeStretch, OHH, PFP, MI = 13 confirmed) inherited
the cache-nuke behavior. See
`PLATFORM ADMIN BUILD/DISCOVERED/DISCOVERED-RELLO-SERVICE-KEYS-DEPLOY-THRASH-RESILIENCE-050826.md`
for the full evidence trail.

#### New config field

```ts
interface PlatformKeyValidatorConfig {
  // existing…
  /** Default: 30 * 60 * 1000 (30 min). Set to 0 to disable stale-serve. */
  staleServeMaxMs?: number;
}
```

Worst-case staleness window with default `cacheTtlMs` (5 min) is 35 min from
the last successful fetch. After the cap, the validator fails closed.

#### Decision tree at the read site

| Cache state | Last fetch status | Behavior |
|---|---|---|
| empty (`lastSuccessTime === 0`) | any | fail-closed — no cache to serve |
| populated | `ok` | normal lookup |
| populated | `5xx`, `network`, `timeout` & age ≤ cap | serve stale + emit `WARN serving stale cache` once per failure boundary |
| populated | `5xx`, `network`, `timeout` & age > cap | fail-closed + emit `WARN cache exceeded stale-serve cap` once per cap-exceed boundary |
| populated | `4xx` | fail-closed — masks credential drift if served stale |

#### New telemetry prefixes

- `[platform-key-validator] WARN serving stale cache age_ms=<N> reason=upstream-<5xx|network|timeout>`
- `[platform-key-validator] WARN cache exceeded stale-serve cap age_ms=<N> capMs=<N> reason=upstream-<...>`

Emit gating is once-per-failure-boundary (not per inbound request) — the next
successful refresh resets both flags.

#### Backward compatibility

Zero-touch upgrade. Existing v2.10.0 callers without `staleServeMaxMs` get the
30-min default. Behavior on the fresh-cache path is unchanged. 4xx fetch
failures fail-closed as in v2.10.0 (no new credential-drift masking surface).
