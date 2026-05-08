/**
 * SPEC-PE-ADDRESS-NORMALIZE — typed contract for the
 * `POST /api/address-normalize` endpoint hosted by Property Engine.
 *
 * Consumers reach this surface via:
 *
 *   const pe = await rello.service("property-engine");
 *   const out = await pe.addressNormalize({ rawAddress: "..." }, tenantId);
 *
 * Spec body lives in iCloud:
 *   `RELLO TO BE BUILT/BUILD-|-FEATURE-ADDS/PE ADDRESS NORMALIZE/SPEC-PE-ADDRESS-NORMALIZE.md`
 *
 * Design lock — Parcel registry is platform-shared (NOT tenant-scoped); FIPS
 * resolution is via `FipsMapping`, not `Parcel.fips` (which doesn't exist).
 * `tenantId` is REQUIRED for auth + audit-logging only — it does NOT narrow
 * the Parcel match. Recorded in
 * `RELLO TO BE BUILT/APP REBUILDS/~DISCOVERED-PROMPTS/DONE/IMPL-AGENT-UNHALT-PE-ADDRESS-NORMALIZE-PARCEL-SCOPING-LOCK.md`.
 */

/** Free-form input variant — comma-separated address string. */
export interface AddressNormalizeFreeFormInput {
  rawAddress: string;
  /** Optional 2-letter / full-name state override when rawAddress lacks one. */
  state?: string | null;
}

/** Pre-split input variant — caller already has structured fields. */
export interface AddressNormalizePreSplitInput {
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  unit?: string | null;
  county?: string | null;
  apn?: string | null;
}

export type AddressNormalizeRequest =
  | AddressNormalizeFreeFormInput
  | AddressNormalizePreSplitInput;

export type AddressNormalizeMatchedBy =
  | "apn-county"
  | "address-fallback"
  | "none";

export interface AddressNormalizeResponse {
  success: true;
  /** Human-readable canonical form: "<street>, <city>, <STATE> <zip>". */
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
    /** Platform-shared Parcel.id; null when no natural-key match. */
    parcelId: string | null;
    /** 5-digit county FIPS via `FipsMapping(zipCode)`; null when no mapping exists. */
    fips: string | null;
    matchedBy: AddressNormalizeMatchedBy;
  };
}
