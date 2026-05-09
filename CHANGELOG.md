# Changelog

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
