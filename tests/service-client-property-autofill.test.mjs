import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createServiceClient,
  PROPERTY_AUTOFILL_FIELD_KEYS,
} from "../dist/index.js";

// SPEC-PE-PFP-PROPERTY-AUTOFILL — verify ServiceClient.propertyAutofill() posts
// to /api/property-autofill with the right headers + body shape.

function makeFetchMock(responseBody, { status = 200, captureRef } = {}) {
  return async (url, init) => {
    if (captureRef) {
      captureRef.url = url;
      captureRef.init = init;
    }
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

test("propertyAutofill: posts to /api/property-autofill with Bearer + tenant + slug headers", async () => {
  const captured = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchMock(
    {
      success: true,
      canonicalAddress: "123 Main St, Anytown, UT 84101",
      normalizedComponents: {
        streetAddress: "123 Main St",
        city: "Anytown",
        state: "UT",
        zipCode: "84101",
        unit: null,
        county: null,
        apn: null,
      },
      parcelResolution: { parcelId: null, fips: null, matchedBy: "none" },
      listing: null,
      propertyDetails: null,
      attom: null,
      cache: { hit: false, key: null },
    },
    { captureRef: captured },
  );

  try {
    const pe = createServiceClient({
      baseUrl: "https://property-engine.example/",
      apiKey: "rello_test_key_abc",
      appSlug: "pathfinder-pro",
    });

    const out = await pe.propertyAutofill(
      {
        rawAddress: "123 Main St, Anytown, UT 84101",
        includeMls: true,
        includeAttom: false,
        selectedFields: ["beds", "baths"],
      },
      "tenant-xyz",
    );

    assert.equal(captured.url, "https://property-engine.example/api/property-autofill");
    assert.equal(captured.init.method, "POST");
    assert.equal(captured.init.headers.Authorization, "Bearer rello_test_key_abc");
    assert.equal(captured.init.headers["X-App-Slug"], "pathfinder-pro");
    assert.equal(captured.init.headers["X-Tenant-Id"], "tenant-xyz");
    assert.equal(captured.init.headers["Content-Type"], "application/json");

    const body = JSON.parse(captured.init.body);
    assert.equal(body.rawAddress, "123 Main St, Anytown, UT 84101");
    assert.equal(body.includeMls, true);
    assert.equal(body.includeAttom, false);
    assert.deepEqual(body.selectedFields, ["beds", "baths"]);

    assert.equal(out.success, true);
    assert.equal(out.canonicalAddress, "123 Main St, Anytown, UT 84101");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("propertyAutofill: pre-split input variant posts structured fields", async () => {
  const captured = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchMock(
    {
      success: true,
      canonicalAddress: "456 Oak Ave, Salt Lake City, UT 84102",
      normalizedComponents: {
        streetAddress: "456 Oak Ave",
        city: "Salt Lake City",
        state: "UT",
        zipCode: "84102",
        unit: null,
        county: "Salt Lake",
        apn: "12-345-6789",
      },
      parcelResolution: { parcelId: "p-abc", fips: "49035", matchedBy: "apn-county" },
      listing: null,
      propertyDetails: null,
      attom: null,
      cache: { hit: false, key: "p-abc::beds,baths::no-attom" },
    },
    { captureRef: captured },
  );

  try {
    const pe = createServiceClient({
      baseUrl: "https://property-engine.example",
      apiKey: "rello_test_key_abc",
      appSlug: "pathfinder-pro",
    });

    const out = await pe.propertyAutofill(
      {
        streetAddress: "456 Oak Ave",
        city: "Salt Lake City",
        state: "UT",
        zipCode: "84102",
        county: "Salt Lake",
        apn: "12-345-6789",
      },
      "tenant-xyz",
    );

    const body = JSON.parse(captured.init.body);
    assert.equal(body.streetAddress, "456 Oak Ave");
    assert.equal(body.city, "Salt Lake City");
    assert.equal(body.state, "UT");
    assert.equal(body.zipCode, "84102");
    assert.equal(body.county, "Salt Lake");
    assert.equal(body.apn, "12-345-6789");
    assert.equal(out.success, true);
    if (out.success) {
      assert.equal(out.parcelResolution.parcelId, "p-abc");
      assert.equal(out.parcelResolution.matchedBy, "apn-county");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PROPERTY_AUTOFILL_FIELD_KEYS: exports 9 canonical fields matching PE schema", () => {
  assert.deepEqual([...PROPERTY_AUTOFILL_FIELD_KEYS], [
    "beds",
    "baths",
    "sqft",
    "yearBuilt",
    "lotSizeSqft",
    "propertyType",
    "estimatedValue",
    "lastSaleDate",
    "lastSalePrice",
  ]);
});

test("propertyAutofill: surfaces error response body (success:false)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchMock(
    {
      success: false,
      error: "Unable to parse address",
      code: "UNPARSEABLE_ADDRESS",
    },
    { status: 200 },
  );

  try {
    const pe = createServiceClient({
      baseUrl: "https://property-engine.example",
      apiKey: "rello_test_key_abc",
      appSlug: "pathfinder-pro",
    });

    const out = await pe.propertyAutofill(
      { rawAddress: "garbage" },
      "tenant-xyz",
    );

    assert.equal(out.success, false);
    if (!out.success) {
      assert.equal(out.code, "UNPARSEABLE_ADDRESS");
      assert.equal(out.error, "Unable to parse address");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
