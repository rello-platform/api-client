/**
 * implicit-apikey-telemetry — make the implicit-RELLO_API_KEY fallback COUNTABLE.
 *
 * WHY A WARNING ALONE IS NOT ENOUGH
 * --------------------------------
 * A `console.warn` in a Trigger.dev worker goes somewhere nobody reads. This
 * platform has been bitten by exactly that shape more than once — a mechanism
 * that reports honestly and hands off to nothing. "The fallback fired" is also
 * useless across fourteen construction sites in one repo: without knowing WHICH
 * site, a shrinking list cannot shrink.
 *
 * So the fallback does three things, in increasing order of readability:
 *
 *   1. warns, with the CONSTRUCTION SITE attached (see `callerSite`);
 *   2. records the site here, so a process can be ASKED rather than tailed —
 *      `getImplicitApiKeyUses()` is exported for a health endpoint, a startup
 *      assertion, or a test;
 *   3. is counted STATICALLY by `rello-scripts check-explicit-apikey`, which is
 *      where the number that actually shrinks comes from. Construction sites are
 *      statically visible — that is how "24 of 34" was measured in the first
 *      place — so the count does not depend on anyone reading a log, or on the
 *      code path even running.
 *
 * The runtime half still earns its place: it catches a site the scanner cannot
 * see (a client built from a factory, a config object assembled at runtime), and
 * it is what makes `requireExplicitApiKey: true` actionable per-repo.
 */

/** One implicit construction, keyed by site so repeats collapse. */
export interface ImplicitApiKeyUse {
  /** `file:line:col` of the construction site, or a fallback label. */
  site: string;
  /** How many times this site constructed with the implicit fallback. */
  count: number;
  /** Epoch ms of the first occurrence — useful when correlating with a deploy. */
  firstSeenAt: number;
}

const uses = new Map<string, ImplicitApiKeyUse>();

/** Record one implicit construction. Cheap: a Map write, once per client. */
export function recordImplicitApiKey(site: string): void {
  const existing = uses.get(site);
  if (existing) {
    existing.count += 1;
    return;
  }
  uses.set(site, { site, count: 1, firstSeenAt: Date.now() });
}

/**
 * Every construction site in THIS PROCESS that used the implicit fallback.
 *
 * Process-local by design — this is not a metrics pipeline, it is a thing a
 * process can be asked. Surface it from a health endpoint or assert on it in a
 * startup test; do not expect it to survive a restart.
 */
export function getImplicitApiKeyUses(): ImplicitApiKeyUse[] {
  return [...uses.values()].sort((a, b) => b.count - a.count);
}

/** Total implicit constructions in this process. Zero is the goal. */
export function getImplicitApiKeyCount(): number {
  return uses.size;
}

/** Test seam. */
export function resetImplicitApiKeyUses(): void {
  uses.clear();
}

/**
 * Best-effort `file:line:col` of the code that constructed the client.
 *
 * ⚑ WHAT THIS COSTS, stated because a stack capture is not free. `new Error()`
 * materialises a stack string; on V8 that is roughly a few microseconds and a
 * short-lived allocation. It runs ONCE PER CLIENT CONSTRUCTION — never per
 * request — and only on the implicit path, so a caller that passes its key
 * explicitly pays nothing at all. Clients are typically constructed once per
 * module or once per request handler, not in a loop; if a caller does construct
 * one per request, the fallback warning is the least of that code's problems.
 *
 * ⚑ AND WHAT IT CANNOT DO. Under a bundler (Next.js, tsup) the frame names the
 * BUNDLED file, not the original source, unless source maps are enabled. That is
 * still attributable — a bundled path plus a line is enough to find the site —
 * but it is not always the path a reader expects, which is why the static
 * scanner is the authoritative count and this is the supplement.
 */
export function callerSite(): string {
  const err = new Error();
  const stack = err.stack;
  if (!stack) return "<unknown: no stack available>";

  const lines = stack.split("\n");
  for (const line of lines) {
    // Skip the Error line and any frame inside this package — the first frame
    // outside it is the caller we want to name.
    if (!line.includes("at ")) continue;
    if (line.includes("implicit-apikey-telemetry")) continue;
    if (line.includes("client.ts") || line.includes("client.js")) continue;
    if (line.includes("/@rello-platform/api-client/")) continue;
    if (line.includes("node:internal")) continue;

    // `    at fn (/abs/path/file.ts:12:34)` or `    at /abs/path/file.ts:12:34`
    const m = /\(?([^()\s]+:\d+:\d+)\)?\s*$/.exec(line.trim());
    if (m) return m[1]!;
  }
  return "<unknown: no caller frame outside the package>";
}
