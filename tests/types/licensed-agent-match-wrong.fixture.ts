// Negative type fixture (v2.50.0, HI-22): the shapes the contract refuses. Each line must be an error.
import type { LicensedAgentMatchResult, LicensedAgentMatchRequest } from "../../dist/index.js";

// the spec's old second `status` key for the licence status is not the contract: it is `licenseStatus`
export const a: LicensedAgentMatchResult = { index: 0, status: "matched", licensedAgentId: "x", licenseNumber: "1", licenseState: "UT", licenseStatus: "ACTIVE", confidence: "phone" };
// a matched result without licenseStatus
export const b: LicensedAgentMatchResult = { index: 0, status: "matched", licensedAgentId: "x", licenseNumber: "1", licenseState: "UT", confidence: "name" };
// an input key the route does not take
export const c: LicensedAgentMatchRequest = { inputs: [{ name: "Jane Doe", state: "UT", licenseNumber: "1" }] };
