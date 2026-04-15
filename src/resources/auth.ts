import type { Transport } from "../transport.js";
import type {
  ValidateSessionInput,
  ValidateSessionResponse,
} from "../types/auth.js";

export class AuthResource {
  constructor(private readonly transport: Transport) {}

  /**
   * Validate a rello_session token for spoke apps.
   *
   * POST /api/auth/validate (non-v1 route)
   *
   * Spoke apps (The Oven, Home Scout, etc.) forward the session cookie and
   * receive the user/tenant context. Returns the user profile including
   * tenantId, role, and tenant metadata.
   *
   * @throws RelloAuthError if the token is invalid or expired.
   */
  async validate(
    tenantId: string,
    input: ValidateSessionInput
  ): Promise<ValidateSessionResponse> {
    return this.transport.postRaw<ValidateSessionResponse>(
      "/auth/validate",
      tenantId,
      input
    );
  }
}
