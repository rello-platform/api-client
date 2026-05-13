# Changelog

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
