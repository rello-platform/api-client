/**
 * SPEC-PE-PFP-PROPERTY-AUTOFILL — typed contract for the
 * `POST /api/property-autofill` endpoint hosted by Property Engine.
 *
 * Consumers reach this surface via:
 *
 *   const pe = await rello.service("property-engine");
 *   const out = await pe.propertyAutofill(
 *     { rawAddress: "123 Main St, Anytown, UT 84101", selectedFields: ["beds", "baths"] },
 *     tenantId,
 *   );
 *
 * Spec body lives in iCloud:
 *   `RELLO TO BE BUILT/APP REBUILDS/PROPERTY ENGINE/SPEC-PE-PFP-PROPERTY-AUTOFILL.md`
 *
 * Unified composer endpoint that wraps:
 *   1. Address normalize + Parcel natural-key resolution
 *   2. MLS listing lookup via Property.parcelId (with address-fallback)
 *   3. (Optional) ATTOM enrichment passthrough
 *
 * Eliminates 2-3 sequential round-trips for cross-app callers (PFP Cockpit
 * Section 2, future spokes).
 *
 * TRID guardrail (Design Call #2 lock 2026-05-13):
 * Response describes the borrower's CURRENT RESIDENCE only — never implies
 * subject-property speculation. Consumers MUST NOT wire this to subject-
 * property intake. PFP's TRID stance is that subject-property addresses are
 * never captured pre-LOS-export (`subjectTBDIndicator: true`).
 *
 * Design locks (Build-KA disposition 2026-05-13):
 *   #1 — Unified endpoint is the locked path (§3.4 PFP-side composer REJECTED)
 *   #2 — TRID = current-residence-only
 *   #3 — Selected-fields cache: key (parcelId, sortedFieldKeys, includeAttom);
 *        sortedFieldKeys at cache-write time; 24h MLS / 7d ATTOM TTLs
 *   #4 — api-client extension (this file) ships in v2.18.0
 *
 * `tenantId` is REQUIRED — Property Engine returns 400 if the `X-Tenant-Id`
 * header is absent. Property data (Parcel + MLS listing + ATTOM) is
 * platform-shared / external-keyed; `tenantId` exists for the audit trail
 * dimension and to pass the receiver's auth gate (`lookups:read` permission).
 */

// --- Field-key whitelist (caller-declared selected fields) -----------------

/**
 * Verbatim from PE `src/app/api/property-autofill/route.ts` lines 63-73.
 * Cache key at PE includes `sortedFieldKeys` per SPEC §3.2 Design Call #3.
 */
export const PROPERTY_AUTOFILL_FIELD_KEYS = [
  "beds",
  "baths",
  "sqft",
  "yearBuilt",
  "lotSizeSqft",
  "propertyType",
  "estimatedValue",
  "lastSaleDate",
  "lastSalePrice",
] as const;

export type PropertyAutofillFieldKey =
  (typeof PROPERTY_AUTOFILL_FIELD_KEYS)[number];

// --- Prisma enum mirrors ---------------------------------------------------

/**
 * Mirrors Prisma enum `PropertyStatus` at PE `prisma/schema.prisma:1059-1067`.
 * Inlined as a string-literal union to avoid an `@prisma/client` dependency
 * in the api-client package.
 */
export type PropertyAutofillPropertyStatus =
  | "ACTIVE"
  | "PENDING"
  | "SOLD"
  | "WITHDRAWN"
  | "EXPIRED"
  | "COMING_SOON"
  | "OFF_MARKET";

/**
 * Mirrors Prisma enum `PropertyType` at PE `prisma/schema.prisma:1075-1084`.
 * Inlined as a string-literal union to avoid an `@prisma/client` dependency
 * in the api-client package.
 */
export type PropertyAutofillPropertyType =
  | "SINGLE_FAMILY"
  | "CONDO"
  | "TOWNHOUSE"
  | "MULTI_FAMILY"
  | "LAND"
  | "COMMERCIAL"
  | "MOBILE_HOME"
  | "OTHER";

// --- Request types ---------------------------------------------------------

/** Free-form input variant — comma-separated address string. */
export interface PropertyAutofillFreeFormInput {
  rawAddress: string;
  /** Optional state override when rawAddress lacks one. */
  state?: string | null;
  includeMls?: boolean;
  includeAttom?: boolean;
  /** Caller-declared field whitelist; cache key includes sortedFieldKeys per SPEC §3.2 Design Call #3. */
  selectedFields?: PropertyAutofillFieldKey[];
}

/** Pre-split input variant — caller already has structured fields. */
export interface PropertyAutofillPreSplitInput {
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  unit?: string | null;
  county?: string | null;
  apn?: string | null;
  includeMls?: boolean;
  includeAttom?: boolean;
  selectedFields?: PropertyAutofillFieldKey[];
}

export type PropertyAutofillRequest =
  | PropertyAutofillFreeFormInput
  | PropertyAutofillPreSplitInput;

// --- Response types (verbatim from PE route file lines 118-187) ------------

export interface PropertyAutofillListing {
  listingId: string;
  mlsNumber: string | null;
  status: PropertyAutofillPropertyStatus;
  listPrice: number | null;
  listDate: string | null; // ISO-8601
  matchedBy: "parcel-id" | "address-fallback" | "none";
}

export interface PropertyAutofillFieldShape {
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  yearBuilt?: number | null;
  lotSizeSqft?: number | null;
  propertyType?: PropertyAutofillPropertyType | null;
  estimatedValue?: number | null;
  lastSaleDate?: string | null;
  lastSalePrice?: number | null;
}

export interface PropertyAutofillAttomSummary {
  attomId: number | null;
  yearBuilt: number | null;
  lotSizeSqft: number | null;
  buildingSqFt: number | null;
  estimatedValue: number | null;
  lastSaleDate: string | null;
  lastSalePrice: number | null;
}

export interface PropertyAutofillResponseSuccess {
  success: true;
  canonicalAddress: string;
  normalizedComponents: {
    streetAddress: string;
    city: string;
    state: string;
    zipCode: string;
    unit: string | null;
    county: string | null;
    apn: string | null;
  };
  parcelResolution: {
    parcelId: string | null;
    fips: string | null;
    matchedBy: "apn-county" | "address-fallback" | "none";
  };
  listing: PropertyAutofillListing | null;
  propertyDetails: PropertyAutofillFieldShape | null;
  attom: PropertyAutofillAttomSummary | null;
  cache: { hit: boolean; key: string | null };
}

export interface PropertyAutofillResponseError {
  success: false;
  error: string;
  code:
    | "BAD_JSON"
    | "VALIDATION_ERROR"
    | "UNPARSEABLE_ADDRESS"
    | "NORMALIZE_FAILED"
    | "MLS_LOOKUP_FAILED"
    | "ATTOM_LOOKUP_FAILED";
  details?: unknown;
}

export type PropertyAutofillResponse =
  | PropertyAutofillResponseSuccess
  | PropertyAutofillResponseError;
