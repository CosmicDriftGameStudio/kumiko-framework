import { ROLES } from "../auth/roles.js";
import { AccessDeniedError, FrameworkReasons } from "../errors/index.js";
import type { SessionUser } from "./types/index.js";

export function mayOverrideTenant(user: SessionUser): boolean {
  return user.roles.includes(ROLES.SystemAdmin);
}

function carriesTenantOverride(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "tenantIdOverride" in payload &&
    payload.tenantIdOverride !== undefined
  );
}

// A payload-supplied target tenant (tenantIdOverride) is the cross-tenant escape hatch:
// hasAccess passes a handler for any TenantAdmin, so the dispatcher refuses the field
// for everyone but a SystemAdmin before any handler sees it. Runs on the schema-parsed
// payload, so only handlers that declare the field are affected.
export function tenantOverrideDenied(
  user: SessionUser,
  parsedPayload: unknown,
): AccessDeniedError | undefined {
  if (!carriesTenantOverride(parsedPayload) || mayOverrideTenant(user)) return undefined;
  return new AccessDeniedError({
    details: { reason: FrameworkReasons.tenantOverrideRequiresSystemAdmin },
  });
}
