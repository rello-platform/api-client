// Type fixture for tests/permissions-repin-rate-check-price.test.mjs (v2.32.0).
// Compiled with the TypeScript API against the BUILT dist/index.d.ts, exactly
// as a consumer sees it. Home Scout's rate-check price route (PFP Gateway G-RC,
// spec rev 10.20 §4.12d item 4) passes "rate-check:price"; at v2.31.0 the
// guard's PermissionSlug came from api-client's own @rello-platform/permissions
// v0.54.0, which has no such slug (TS2322).
import { callerHasPermission, createServiceBearerGuard, type PlatformCaller } from "../../dist/index.js";

const requireServiceBearer = createServiceBearerGuard({ getValidator: () => null });

export async function priceRoute(request: Request): Promise<Response | PlatformCaller> {
  // eslint-disable-next-line @rello-platform/permissions/no-string-permission -- the literal's type is what this fixture tests (a consumer passing the v0.60.0 slug)
  return requireServiceBearer(request, { permission: "rate-check:price" });
}

export function holdsAgentContact(caller: PlatformCaller): boolean {
  return callerHasPermission(caller, "agents:contact:write");
}
