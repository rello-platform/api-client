// Type fixture for tests/g-a2p-setup-charge-sms-registration.test.mjs (v2.34.0).
// Compiled with the TypeScript API against the BUILT dist/index.d.ts, exactly
// as a consumer sees it. The G-SETUP / G-A2P routes are guarded by the
// permissions v0.61.0 slugs; at v2.33.0 api-client's own
// @rello-platform/permissions pin was v0.60.0, which has neither (TS2322), and
// npm nests that older copy under api-client, so a consumer's own newer pin does
// not help the guard's PermissionSlug union.
import { callerHasPermission, createServiceBearerGuard, type PlatformCaller } from "../../dist/index.js";

const requireServiceBearer = createServiceBearerGuard({ getValidator: () => null });

export async function setupChargeRoute(request: Request): Promise<Response | PlatformCaller> {
  // eslint-disable-next-line @rello-platform/permissions/no-string-permission -- the literal's type is what this fixture tests (a consumer passing the v0.61.0 slug)
  return requireServiceBearer(request, { permission: "billing:setup-charge:write" });
}

export function holdsSmsRegistration(caller: PlatformCaller): boolean {
  // eslint-disable-next-line @rello-platform/permissions/no-string-permission -- the literal's type is what this fixture tests (a consumer passing the v0.61.0 slug)
  return callerHasPermission(caller, "sms:registration:write");
}

export function holdsPlanSwitch(caller: PlatformCaller): boolean {
  // eslint-disable-next-line @rello-platform/permissions/no-string-permission -- the literal's type is what this fixture tests (the v0.62.0 slug)
  return callerHasPermission(caller, "billing:plan-switch:write");
}
