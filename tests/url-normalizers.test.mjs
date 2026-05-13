import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getRelloBaseUrl,
  getMiloBaseUrl,
  getHarvestHomeBaseUrl,
  getPropertyEngineBaseUrl,
} from "../dist/index.js";

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

// --- getHarvestHomeBaseUrl ---

test("getHarvestHomeBaseUrl: canonical domain-root env passes through unchanged", () => {
  withEnv("HH_INTAKE_URL", "https://harvesthome.app", () => {
    assert.equal(getHarvestHomeBaseUrl(), "https://harvesthome.app");
  });
});

test("getHarvestHomeBaseUrl: legacy /api-suffixed env strips /api", () => {
  withEnv("HH_INTAKE_URL", "https://harvesthome.app/api", () => {
    assert.equal(getHarvestHomeBaseUrl(), "https://harvesthome.app");
  });
});

test("getHarvestHomeBaseUrl: legacy /api/-suffixed env strips /api/", () => {
  withEnv("HH_INTAKE_URL", "https://harvesthome.app/api/", () => {
    assert.equal(getHarvestHomeBaseUrl(), "https://harvesthome.app");
  });
});

test("getHarvestHomeBaseUrl: trailing-slash-only env strips slash", () => {
  withEnv("HH_INTAKE_URL", "https://harvesthome.app/", () => {
    assert.equal(getHarvestHomeBaseUrl(), "https://harvesthome.app");
  });
});

test("getHarvestHomeBaseUrl: multiple trailing slashes all stripped", () => {
  withEnv("HH_INTAKE_URL", "https://harvesthome.app///", () => {
    assert.equal(getHarvestHomeBaseUrl(), "https://harvesthome.app");
  });
});

test("getHarvestHomeBaseUrl: missing env with no fallback returns empty string", () => {
  withEnv("HH_INTAKE_URL", undefined, () => {
    assert.equal(getHarvestHomeBaseUrl(), "");
  });
});

test("getHarvestHomeBaseUrl: missing env uses fallback when provided", () => {
  withEnv("HH_INTAKE_URL", undefined, () => {
    assert.equal(
      getHarvestHomeBaseUrl("https://harvesthome.app"),
      "https://harvesthome.app"
    );
  });
});

test("getHarvestHomeBaseUrl: fallback also gets /api stripped", () => {
  withEnv("HH_INTAKE_URL", undefined, () => {
    assert.equal(
      getHarvestHomeBaseUrl("https://harvesthome.app/api"),
      "https://harvesthome.app"
    );
  });
});

test("getHarvestHomeBaseUrl: env-set value overrides fallback", () => {
  withEnv("HH_INTAKE_URL", "https://prod.harvesthome.app", () => {
    assert.equal(
      getHarvestHomeBaseUrl("https://staging.harvesthome.app"),
      "https://prod.harvesthome.app"
    );
  });
});

test("getHarvestHomeBaseUrl: leading whitespace in env value is trimmed", () => {
  withEnv("HH_INTAKE_URL", "  https://harvesthome.app", () => {
    assert.equal(getHarvestHomeBaseUrl(), "https://harvesthome.app");
  });
});

test("getHarvestHomeBaseUrl: trailing whitespace in env value is trimmed", () => {
  withEnv("HH_INTAKE_URL", "https://harvesthome.app  ", () => {
    assert.equal(getHarvestHomeBaseUrl(), "https://harvesthome.app");
  });
});

test("getHarvestHomeBaseUrl: whitespace after trailing /api gets stripped (trim before regex)", () => {
  withEnv("HH_INTAKE_URL", "https://harvesthome.app/api  ", () => {
    assert.equal(getHarvestHomeBaseUrl(), "https://harvesthome.app");
  });
});

test("getHarvestHomeBaseUrl: leading whitespace in fallback (env unset) is trimmed", () => {
  withEnv("HH_INTAKE_URL", undefined, () => {
    assert.equal(
      getHarvestHomeBaseUrl("  https://harvesthome.app"),
      "https://harvesthome.app"
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

test("helpers are independent: setting RELLO_API_URL does not affect getHarvestHomeBaseUrl", () => {
  withEnv("RELLO_API_URL", "https://hellorello.app", () => {
    withEnv("HH_INTAKE_URL", undefined, () => {
      assert.equal(getHarvestHomeBaseUrl(), "");
    });
  });
});

test("helpers are independent: setting HH_INTAKE_URL does not affect getRelloBaseUrl", () => {
  withEnv("HH_INTAKE_URL", "https://harvesthome.app", () => {
    withEnv("RELLO_API_URL", undefined, () => {
      assert.equal(getRelloBaseUrl(), "");
    });
  });
});

test("helpers are independent: setting MILO_API_URL does not affect getHarvestHomeBaseUrl", () => {
  withEnv("MILO_API_URL", "https://milo-engine-production.up.railway.app", () => {
    withEnv("HH_INTAKE_URL", undefined, () => {
      assert.equal(getHarvestHomeBaseUrl(), "");
    });
  });
});

// --- getPropertyEngineBaseUrl ---

test("getPropertyEngineBaseUrl: canonical domain-root env passes through unchanged", () => {
  withEnv("PROPERTY_ENGINE_API_URL", "https://property-engine.app", () => {
    assert.equal(getPropertyEngineBaseUrl(), "https://property-engine.app");
  });
});

test("getPropertyEngineBaseUrl: legacy /api-suffixed env strips /api", () => {
  withEnv("PROPERTY_ENGINE_API_URL", "https://property-engine.app/api", () => {
    assert.equal(getPropertyEngineBaseUrl(), "https://property-engine.app");
  });
});

test("getPropertyEngineBaseUrl: legacy /api/-suffixed env strips /api/", () => {
  withEnv("PROPERTY_ENGINE_API_URL", "https://property-engine.app/api/", () => {
    assert.equal(getPropertyEngineBaseUrl(), "https://property-engine.app");
  });
});

test("getPropertyEngineBaseUrl: trailing-slash-only env strips slash", () => {
  withEnv("PROPERTY_ENGINE_API_URL", "https://property-engine.app/", () => {
    assert.equal(getPropertyEngineBaseUrl(), "https://property-engine.app");
  });
});

test("getPropertyEngineBaseUrl: multiple trailing slashes all stripped", () => {
  withEnv("PROPERTY_ENGINE_API_URL", "https://property-engine.app///", () => {
    assert.equal(getPropertyEngineBaseUrl(), "https://property-engine.app");
  });
});

test("getPropertyEngineBaseUrl: missing env with no fallback returns empty string", () => {
  withEnv("PROPERTY_ENGINE_API_URL", undefined, () => {
    assert.equal(getPropertyEngineBaseUrl(), "");
  });
});

test("getPropertyEngineBaseUrl: missing env uses fallback when provided", () => {
  withEnv("PROPERTY_ENGINE_API_URL", undefined, () => {
    assert.equal(
      getPropertyEngineBaseUrl("https://property-engine.app"),
      "https://property-engine.app"
    );
  });
});

test("getPropertyEngineBaseUrl: fallback also gets /api stripped", () => {
  withEnv("PROPERTY_ENGINE_API_URL", undefined, () => {
    assert.equal(
      getPropertyEngineBaseUrl("https://property-engine.app/api"),
      "https://property-engine.app"
    );
  });
});

test("getPropertyEngineBaseUrl: env-set value overrides fallback", () => {
  withEnv("PROPERTY_ENGINE_API_URL", "https://prod.property-engine.app", () => {
    assert.equal(
      getPropertyEngineBaseUrl("https://staging.property-engine.app"),
      "https://prod.property-engine.app"
    );
  });
});

test("getPropertyEngineBaseUrl: leading whitespace in env value is trimmed", () => {
  withEnv("PROPERTY_ENGINE_API_URL", "  https://property-engine.app", () => {
    assert.equal(getPropertyEngineBaseUrl(), "https://property-engine.app");
  });
});

test("getPropertyEngineBaseUrl: trailing whitespace in env value is trimmed", () => {
  withEnv("PROPERTY_ENGINE_API_URL", "https://property-engine.app  ", () => {
    assert.equal(getPropertyEngineBaseUrl(), "https://property-engine.app");
  });
});

test("getPropertyEngineBaseUrl: whitespace after trailing /api gets stripped (trim before regex)", () => {
  withEnv("PROPERTY_ENGINE_API_URL", "https://property-engine.app/api  ", () => {
    assert.equal(getPropertyEngineBaseUrl(), "https://property-engine.app");
  });
});

test("getPropertyEngineBaseUrl: leading whitespace in fallback (env unset) is trimmed", () => {
  withEnv("PROPERTY_ENGINE_API_URL", undefined, () => {
    assert.equal(
      getPropertyEngineBaseUrl("  https://property-engine.app"),
      "https://property-engine.app"
    );
  });
});

// --- Independence: PE helper isolated from other env vars ---

test("helpers are independent: setting RELLO_API_URL does not affect getPropertyEngineBaseUrl", () => {
  withEnv("RELLO_API_URL", "https://hellorello.app", () => {
    withEnv("PROPERTY_ENGINE_API_URL", undefined, () => {
      assert.equal(getPropertyEngineBaseUrl(), "");
    });
  });
});

test("helpers are independent: setting PROPERTY_ENGINE_API_URL does not affect getMiloBaseUrl", () => {
  withEnv("PROPERTY_ENGINE_API_URL", "https://property-engine.app", () => {
    withEnv("MILO_API_URL", undefined, () => {
      assert.equal(getMiloBaseUrl(), "");
    });
  });
});
