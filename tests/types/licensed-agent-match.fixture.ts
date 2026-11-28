// Type fixture for tests/licensed-agent-match-types.test.mjs (v2.50.0, HI-22). Compiled with the
// TypeScript API against the BUILT dist/index.d.ts, as Rello (HI-40) will see it.
import type {
  LicensedAgentMatchRequest,
  LicensedAgentMatchResponse,
  LicensedAgentMatchResult,
} from "../../dist/index.js";

export const request: LicensedAgentMatchRequest = {
  inputs: [
    { name: "Jane Doe", state: "UT" },
    { name: "John Smith", state: "TX", email: null, phone: "801-555-0100", brokerage: "Made Up Realty" },
  ],
};

export const response: LicensedAgentMatchResponse = {
  results: [
    { index: 0, status: "matched", licensedAgentId: "a1", licenseNumber: "9100001-SA00", licenseState: "UT", licenseStatus: "ACTIVE", confidence: "name" },
    { index: 1, status: "ambiguous", candidates: [{ licensedAgentId: "a2", licenseNumber: null, licenseStatus: "LAPSED", brokerage: null }] },
    { index: 2, status: "no_match" },
    { index: 3, status: "state_not_loaded" },
  ],
};

/** Every status is handled: adding one to the union without handling it here fails this fixture. */
export function describe(r: LicensedAgentMatchResult): string {
  switch (r.status) {
    case "matched":
      return `${r.licensedAgentId} by ${r.confidence}`;
    case "ambiguous":
      return `${r.candidates.length} candidates`;
    case "no_match":
      return "no match";
    case "state_not_loaded":
      return "state not loaded";
    default: {
      const never: never = r;
      return never;
    }
  }
}
