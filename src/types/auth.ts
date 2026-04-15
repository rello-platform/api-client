/** Input for POST /api/auth/validate */
export interface ValidateSessionInput {
  /** The rello_session token to validate. */
  token: string;
}

/** Tenant info returned from session validation. */
export interface ValidatedTenant {
  id: string;
  name: string;
  type: string;
  slug: string | null;
}

/** User data returned from session validation. */
export interface ValidatedUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  tenantId: string;
  tenant: ValidatedTenant | null;
}

/** Successful response from POST /api/auth/validate */
export interface ValidateSessionResponse {
  success: true;
  data: ValidatedUser;
}

/** Error response from POST /api/auth/validate */
export interface ValidateSessionError {
  success: false;
  error: string;
}
