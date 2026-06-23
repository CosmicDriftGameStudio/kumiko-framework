import { AccessDeniedError } from "../errors";
import type { SessionUser } from "./types";

// A payload-supplied target tenant (tenantIdOverride) on a TenantAdmin-reachable
// handler is the cross-tenant escape hatch: hasAccess passes the handler for any
// TenantAdmin, so without a SystemAdmin gate a TenantAdmin could act on another
// tenant. Centralizes the check the override handlers used to inline. Returns
// the denial to `throw` (queries) or wrap in `writeFailure` (writes), or
// undefined when allowed. The i18nKey stays per-feature so existing
// translations keep resolving.
export function crossTenantOverrideDenied(
  user: SessionUser,
  tenantIdOverride: string | undefined,
  i18nKey: string,
): AccessDeniedError | undefined {
  if (tenantIdOverride === undefined) return undefined;
  if (user.roles.includes("SystemAdmin")) return undefined;
  return new AccessDeniedError({
    i18nKey,
    details: { reason: "tenant_override_requires_system_admin" },
  });
}
