# Changelog

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
