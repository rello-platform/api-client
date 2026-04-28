import { test } from "node:test";
import assert from "node:assert/strict";
import { getRelloBaseUrl, getMiloBaseUrl } from "../dist/index.js";

// Helper to swap env around a test without leaking state.
function withEnv(key, value, fn) {
  const previous = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
}

// --- getRelloBaseUrl ---

test("getRelloBaseUrl: canonical domain-root env passes through unchanged", () => {
  withEnv("RELLO_API_URL", "https://hellorello.app", () => {
    assert.equal(getRelloBaseUrl(), "https://hellorello.app");
  });
});

test("getRelloBaseUrl: legacy /api-suffixed env strips /api", () => {
  withEnv("RELLO_API_URL", "https://hellorello.app/api", () => {
    assert.equal(getRelloBaseUrl(), "https://hellorello.app");
  });
});

test("getRelloBaseUrl: legacy /api/-suffixed env strips /api/", () => {
  withEnv("RELLO_API_URL", "https://hellorello.app/api/", () => {
    assert.equal(getRelloBaseUrl(), "https://hellorello.app");
  });
});

test("getRelloBaseUrl: trailing-slash-only env strips slash", () => {
  withEnv("RELLO_API_URL", "https://hellorello.app/", () => {
    assert.equal(getRelloBaseUrl(), "https://hellorello.app");
  });
});

test("getRelloBaseUrl: multiple trailing slashes all stripped", () => {
  withEnv("RELLO_API_URL", "https://hellorello.app///", () => {
    assert.equal(getRelloBaseUrl(), "https://hellorello.app");
  });
});

test("getRelloBaseUrl: missing env with no fallback returns empty string", () => {
  withEnv("RELLO_API_URL", undefined, () => {
    assert.equal(getRelloBaseUrl(), "");
  });
});

test("getRelloBaseUrl: missing env uses fallback when provided", () => {
  withEnv("RELLO_API_URL", undefined, () => {
    assert.equal(
      getRelloBaseUrl("https://hellorello.app"),
      "https://hellorello.app"
    );
  });
});

test("getRelloBaseUrl: fallback also gets /api stripped", () => {
  withEnv("RELLO_API_URL", undefined, () => {
    assert.equal(
      getRelloBaseUrl("https://hellorello.app/api"),
      "https://hellorello.app"
    );
  });
});

test("getRelloBaseUrl: env-set value overrides fallback", () => {
  withEnv("RELLO_API_URL", "https://prod.hellorello.app", () => {
    assert.equal(
      getRelloBaseUrl("https://staging.hellorello.app"),
      "https://prod.hellorello.app"
    );
  });
});

// v2.7.0 — defensive .trim() on (env || fallback) before regex strips.
// Regression coverage for the e63a77d lockstep retrofit (operator-introduced
// whitespace on Railway env values like MarketIntel's "https://...app ").

test("getRelloBaseUrl: leading whitespace in env value is trimmed", () => {
  withEnv("RELLO_API_URL", "  https://hellorello.app", () => {
    assert.equal(getRelloBaseUrl(), "https://hellorello.app");
  });
});

test("getRelloBaseUrl: trailing whitespace in env value is trimmed", () => {
  withEnv("RELLO_API_URL", "https://hellorello.app  ", () => {
    assert.equal(getRelloBaseUrl(), "https://hellorello.app");
  });
});

test("getRelloBaseUrl: whitespace after trailing /api gets stripped (trim before regex)", () => {
  withEnv("RELLO_API_URL", "https://hellorello.app/api  ", () => {
    assert.equal(getRelloBaseUrl(), "https://hellorello.app");
  });
});

test("getRelloBaseUrl: leading whitespace in fallback (env unset) is trimmed", () => {
  withEnv("RELLO_API_URL", undefined, () => {
    assert.equal(
      getRelloBaseUrl("  https://hellorello.app"),
      "https://hellorello.app"
    );
  });
});

// --- getMiloBaseUrl ---

test("getMiloBaseUrl: canonical domain-root env passes through unchanged", () => {
  withEnv("MILO_API_URL", "https://milo-engine-production.up.railway.app", () => {
    assert.equal(
      getMiloBaseUrl(),
      "https://milo-engine-production.up.railway.app"
    );
  });
});

test("getMiloBaseUrl: legacy /api-suffixed env strips /api", () => {
  withEnv("MILO_API_URL", "https://milo-engine-production.up.railway.app/api", () => {
    assert.equal(
      getMiloBaseUrl(),
      "https://milo-engine-production.up.railway.app"
    );
  });
});

test("getMiloBaseUrl: legacy /api/-suffixed env strips /api/", () => {
  withEnv("MILO_API_URL", "https://milo-engine-production.up.railway.app/api/", () => {
    assert.equal(
      getMiloBaseUrl(),
      "https://milo-engine-production.up.railway.app"
    );
  });
});

test("getMiloBaseUrl: trailing-slash-only env strips slash", () => {
  withEnv("MILO_API_URL", "https://milo-engine-production.up.railway.app/", () => {
    assert.equal(
      getMiloBaseUrl(),
      "https://milo-engine-production.up.railway.app"
    );
  });
});

test("getMiloBaseUrl: missing env with no fallback returns empty string", () => {
  withEnv("MILO_API_URL", undefined, () => {
    assert.equal(getMiloBaseUrl(), "");
  });
});

test("getMiloBaseUrl: missing env uses fallback when provided", () => {
  withEnv("MILO_API_URL", undefined, () => {
    assert.equal(
      getMiloBaseUrl("https://milo-engine-production.up.railway.app"),
      "https://milo-engine-production.up.railway.app"
    );
  });
});

test("getMiloBaseUrl: fallback also gets /api stripped", () => {
  withEnv("MILO_API_URL", undefined, () => {
    assert.equal(
      getMiloBaseUrl("https://milo-engine-production.up.railway.app/api"),
      "https://milo-engine-production.up.railway.app"
    );
  });
});

test("getMiloBaseUrl: env-set value overrides fallback", () => {
  withEnv("MILO_API_URL", "https://prod-milo.example.com", () => {
    assert.equal(
      getMiloBaseUrl("https://fallback-milo.example.com"),
      "https://prod-milo.example.com"
    );
  });
});

// v2.7.0 — defensive .trim() on (env || fallback) before regex strips.
// Regression coverage for the e63a77d lockstep retrofit; the canonical
// e63a77d incident was MI's `MILO_API_URL=...app ` (trailing whitespace).

test("getMiloBaseUrl: leading whitespace in env value is trimmed", () => {
  withEnv("MILO_API_URL", "  https://milo-engine-production.up.railway.app", () => {
    assert.equal(
      getMiloBaseUrl(),
      "https://milo-engine-production.up.railway.app"
    );
  });
});

test("getMiloBaseUrl: trailing whitespace in env value is trimmed", () => {
  withEnv("MILO_API_URL", "https://milo-engine-production.up.railway.app  ", () => {
    assert.equal(
      getMiloBaseUrl(),
      "https://milo-engine-production.up.railway.app"
    );
  });
});

test("getMiloBaseUrl: whitespace after trailing /api gets stripped (trim before regex)", () => {
  withEnv("MILO_API_URL", "https://milo-engine-production.up.railway.app/api  ", () => {
    assert.equal(
      getMiloBaseUrl(),
      "https://milo-engine-production.up.railway.app"
    );
  });
});

test("getMiloBaseUrl: leading whitespace in fallback (env unset) is trimmed", () => {
  withEnv("MILO_API_URL", undefined, () => {
    assert.equal(
      getMiloBaseUrl("  https://milo-engine-production.up.railway.app"),
      "https://milo-engine-production.up.railway.app"
    );
  });
});

// --- Independence: helpers read distinct env vars ---

test("helpers are independent: setting RELLO_API_URL does not affect getMiloBaseUrl", () => {
  withEnv("RELLO_API_URL", "https://hellorello.app", () => {
    withEnv("MILO_API_URL", undefined, () => {
      assert.equal(getMiloBaseUrl(), "");
    });
  });
});

test("helpers are independent: setting MILO_API_URL does not affect getRelloBaseUrl", () => {
  withEnv("MILO_API_URL", "https://milo-engine-production.up.railway.app", () => {
    withEnv("RELLO_API_URL", undefined, () => {
      assert.equal(getRelloBaseUrl(), "");
    });
  });
});
