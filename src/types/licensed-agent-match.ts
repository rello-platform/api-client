/**
 * HI-22 (Platform KA prompt 2408) — typed contract of Property Engine's
 * `POST /api/licensed-agents/match` (auth: a key holding `licensed-agents:read`).
 *
 * For each of up to 500 names from a loan officer's past loans, which licensee in
 * PE's licensed-agent directory it is, or that the directory cannot say. Rello
 * (Home Insight HI-40) imports these types from this package and never
 * redeclares them.
 *
 * ONE SOURCE: the block between the two marker lines is copied verbatim from
 * Property Engine `src/lib/licensed-directory/api-types.ts`. PE's
 * `node scripts/check-licensed-agent-match-contract.mjs <this file>` fails when
 * the two differ after whitespace is normalized. Change the contract in PE
 * first, then copy the block here. Types only: no runtime code.
 */
// <licensed-agent-match-contract>
/** A person's licence status as the directory derives it from their licences. */
export type LicensedAgentMatchLicenseStatus = "ACTIVE" | "INACTIVE" | "LAPSED" | "UNKNOWN";

/**
 * One name to look up. Every key is whitelisted; null is read as absent for the optional keys.
 * name: trimmed, 1..200 characters. state: a two-letter USPS code (50 states + DC), any case.
 * email: trimmed and lower-cased; a value that is not an address is ignored for matching, never a 400.
 * phone: accepted and length-checked, NOT used to match in v1. brokerage: compared by normalized name.
 */
export interface LicensedAgentMatchInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  brokerage?: string | null;
  state: string;
}

/** The request body: 1..500 inputs. */
export interface LicensedAgentMatchRequest {
  inputs: LicensedAgentMatchInput[];
}

/** How a match was made: an own email point, a unique name at the input's brokerage, or a unique name. */
export type LicensedAgentMatchConfidence = "email" | "name+brokerage" | "name";

/** One licensee an ambiguous input could be. */
export interface LicensedAgentMatchCandidate {
  licensedAgentId: string;
  /** null only when the directory holds no licence row for the person. */
  licenseNumber: string | null;
  /** The person's directory status, derived from their licences (any ACTIVE → ACTIVE, …): the list's `status`. */
  licenseStatus: LicensedAgentMatchLicenseStatus;
  /** The person's current brokerage name as the state publishes it; null when none. */
  brokerage: string | null;
}

/**
 * One result per input, in input order; `index` is the input's position (0-based).
 * matched — exactly one licensee. ambiguous — more than one, never auto-picked (≤ 3 candidates shown).
 * no_match — the state is loaded and no licensee fits. state_not_loaded — the directory holds no ACTIVE
 * agent in that state, so it cannot say (kept apart from no_match).
 */
export type LicensedAgentMatchResult =
  | {
      index: number;
      status: "matched";
      licensedAgentId: string;
      /** The person's primary licence (a live one first, then by type): null only when none is on file. */
      licenseNumber: string | null;
      /** The state of that licence (the person's state when there is none). */
      licenseState: string;
      /** The person's directory status, derived from their licences: the list's `status`. */
      licenseStatus: LicensedAgentMatchLicenseStatus;
      confidence: LicensedAgentMatchConfidence;
    }
  | { index: number; status: "ambiguous"; candidates: LicensedAgentMatchCandidate[] }
  | { index: number; status: "no_match" }
  | { index: number; status: "state_not_loaded" };

/** The 200 body: exactly one result per input. */
export interface LicensedAgentMatchResponse {
  results: LicensedAgentMatchResult[];
}
// </licensed-agent-match-contract>
