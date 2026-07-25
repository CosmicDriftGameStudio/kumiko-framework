import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { access } from "@cosmicdrift/kumiko-framework/engine";

const ADMIN_ROLES: ReadonlySet<string> = new Set(access.admin);

// Reused by handlers that are `openToAll: true` but still need a manual
// self-or-admin gate (e.g. restrict-account.write.ts) — Set-lookup instead
// of the O(n·m) `roles.some(role => access.admin.includes(role))` re-scan.
export function isAdminActor(user: Pick<SessionUser, "roles">): boolean {
  return user.roles.some((role) => ADMIN_ROLES.has(role));
}
