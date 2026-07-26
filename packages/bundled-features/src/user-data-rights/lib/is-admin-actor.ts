import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { access } from "@cosmicdrift/kumiko-framework/engine";

const ADMIN_ROLES: ReadonlySet<string> = new Set(access.admin);
const SYSTEM_ADMIN_ROLES: ReadonlySet<string> = new Set(access.systemAdmin);

// Reused by handlers that are `openToAll: true` but still need a manual
// self-or-admin gate (e.g. restrict-account.write.ts) — Set-lookup instead
// of the O(n·m) `roles.some(role => access.admin.includes(role))` re-scan.
export function isAdminActor(user: Pick<SessionUser, "roles">): boolean {
  return user.roles.some((role) => ADMIN_ROLES.has(role));
}

// Platform-wide operator role — exempt from the cross-tenant membership
// check that otherwise gates the tenant-scoped admin roles (TenantAdmin/
// Admin) before they act on another tenant's user.
export function isSystemAdminActor(user: Pick<SessionUser, "roles">): boolean {
  return user.roles.some((role) => SYSTEM_ADMIN_ROLES.has(role));
}
