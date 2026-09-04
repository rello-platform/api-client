// EVIDENCE — the implicit RELLO_API_KEY fallback, and the opt-in that ends it.
//
// The defect is NOT "a missing key is silent" — the constructor already throws
// when nothing resolves. It is that a WRONG key is silent: a caller that means
// to use its own <SPOKE>_TO_RELLO_API_KEY and forgets to pass it silently
// authenticates as whatever RELLO_API_KEY holds. Both clients construct
// identically; the mistake surfaces later as a 401 in another file.
//
// Measured 2026-09-04: 24 of 34 construction sites across 5 repos rely on that
// fallback today. v2.26.0 makes each of them attributable and countable without
// breaking any of them; v3.0.0 removes the fallback once the count is zero.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RelloClient,
  getImplicitApiKeyUses,
  getImplicitApiKeyCount,
  resetImplicitApiKeyUses,
} from "../dist/index.js";

const BASE = "https://hellorello.app";

function withEnv(fn) {
  const saved = { ...process.env };
  process.env.RELLO_API_URL = BASE;
  process.env.APP_SLUG = "test-spoke";
  try {
    return fn();
  } finally {
    process.env = saved;
  }
}

/** Capture console.warn for the duration of fn. */
function capturingWarn(fn) {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return lines;
}

test("implicit construction WARNS, and the warning names the construction site", () => {
  withEnv(() => {
    process.env.RELLO_API_KEY = "rello_env_fallback_key";
    resetImplicitApiKeyUses();

    const warnings = capturingWarn(() => new RelloClient({}));

    assert.equal(warnings.length, 1, "exactly one deprecation warning");
    assert.match(warnings[0], /DEPRECATED/);
    assert.match(warnings[0], /RELLO_API_KEY env var/);
    // Attribution is the whole point: "the fallback fired" is useless across 14
    // sites in one repo. The warning must say WHICH.
    assert.match(warnings[0], /constructed at: /);
    assert.match(
      warnings[0],
      /constructed at: .+:\d+:\d+/,
      "the site must carry file:line:col, not a bare label",
    );
  });
});

test("EXPLICIT construction does not warn at all", () => {
  withEnv(() => {
    process.env.RELLO_API_KEY = "rello_env_fallback_key";
    resetImplicitApiKeyUses();

    const warnings = capturingWarn(() =>
      new RelloClient({ apiKey: "rello_the_key_i_meant" }),
    );

    assert.deepEqual(warnings, [], "an explicit caller pays nothing and hears nothing");
    assert.equal(getImplicitApiKeyCount(), 0, "and is not counted");
  });
});

test("requireExplicitApiKey: true THROWS rather than warning", () => {
  withEnv(() => {
    process.env.RELLO_API_KEY = "rello_env_fallback_key";
    resetImplicitApiKeyUses();

    let threw = null;
    const warnings = capturingWarn(() => {
      try {
        new RelloClient({ requireExplicitApiKey: true });
      } catch (err) {
        threw = err;
      }
    });

    assert.ok(threw, "must throw, not warn");
    assert.match(threw.message, /must be passed explicitly/);
    assert.match(threw.message, /constructed at: /, "the throw is attributable too");
    assert.deepEqual(warnings, [], "a throw replaces the warning; it does not add to it");
  });
});

test("requireExplicitApiKey: true is satisfied by an explicit key", () => {
  withEnv(() => {
    process.env.RELLO_API_KEY = "rello_env_fallback_key";
    // The strict mode must not punish a correct caller.
    const c = new RelloClient({
      apiKey: "rello_the_key_i_meant",
      requireExplicitApiKey: true,
    });
    assert.ok(c.leads, "client constructed normally");
  });
});

test("the six repos already passing apiKey explicitly are unaffected", () => {
  withEnv(() => {
    process.env.RELLO_API_KEY = "rello_env_fallback_key";
    resetImplicitApiKeyUses();
    // HomeReady / The-Home-Scout / The-Drumbeat / Harvest-Home /
    // Newsletter-Studio / PathfinderPro all construct this way today.
    const warnings = capturingWarn(() => {
      new RelloClient({ apiKey: "rello_spoke_pair_key" });
      new RelloClient({ apiKey: "rello_spoke_pair_key", baseUrl: BASE });
    });
    assert.deepEqual(warnings, []);
    assert.equal(getImplicitApiKeyCount(), 0);
  });
});

test("an empty-string apiKey THROWS — it does not silently fall back", () => {
  withEnv(() => {
    process.env.RELLO_API_KEY = "rello_env_fallback_key";
    resetImplicitApiKeyUses();
    // `??` does not fall back on "", so an explicitly-empty key reaches the
    // required-check and throws. That is the right outcome and it predates this
    // change: an empty key is unusable, and failing at construction is exactly
    // the behaviour this whole unit is arguing for. Asserted so a future
    // "helpful" change to `||` cannot quietly turn it into a silent fallback to
    // RELLO_API_KEY — which is the defect, reintroduced.
    assert.throws(() => new RelloClient({ apiKey: "" }), /apiKey is required/);
    assert.equal(getImplicitApiKeyCount(), 0, "a throw is not a counted fallback");
  });
});

test("sites are recorded and deduped, so the list can be read rather than tailed", () => {
  withEnv(() => {
    process.env.RELLO_API_KEY = "rello_env_fallback_key";
    resetImplicitApiKeyUses();

    capturingWarn(() => {
      new RelloClient({});
      new RelloClient({});
    });

    const uses = getImplicitApiKeyUses();
    assert.equal(uses.length, 1, "same site collapses to one entry");
    assert.equal(uses[0].count, 2, "with an occurrence count");
    assert.match(uses[0].site, /:\d+:\d+/);
    assert.ok(uses[0].firstSeenAt > 0);
  });
});

test("no key anywhere still throws — that half was never the defect", () => {
  withEnv(() => {
    delete process.env.RELLO_API_KEY;
    assert.throws(() => new RelloClient({}), /apiKey is required/);
  });
});

test("the fallback still WORKS in v2.26.0 — this release breaks nobody", () => {
  withEnv(() => {
    process.env.RELLO_API_KEY = "rello_env_fallback_key";
    resetImplicitApiKeyUses();
    // 24 sites across 5 repos rely on this today. They must keep working, or
    // the "non-breaking" claim is false.
    const c = capturingWarn(() => new RelloClient({}));
    assert.equal(c.length, 1, "warned");
    // Constructing again outside the capture proves it returns a usable client.
    const client = (() => {
      const orig = console.warn;
      console.warn = () => {};
      try {
        return new RelloClient({});
      } finally {
        console.warn = orig;
      }
    })();
    assert.ok(client.leads && client.signals, "still a fully constructed client");
  });
});
