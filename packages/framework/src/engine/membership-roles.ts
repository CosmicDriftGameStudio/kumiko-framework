// Reserved/platform-global roles must never reach a session via a tenant
// membership. hasAccess checks session.roles flat, with no notion of origin,
// so a membership role like "SystemAdmin" would unlock the SystemAdmin-gated
// cross-tenant surface. The write paths enforce this at command time
// (assertAssignableMembershipRoles), but command-time validation does not
// survive a projection rebuild: replaying a stored membership event goes
// through the apply path, not the handler. stripForbiddenMembershipRoles is
// the read-time backstop — applied at every JWT mint that derives roles from
// membership, it neutralises a resurrected role without touching globalRoles
// (where SystemAdmin legitimately lives).

import { access } from "./config-helpers";

export const FORBIDDEN_MEMBERSHIP_ROLES: ReadonlySet<string> = new Set<string>([
  ...access.privileged, // system, SystemAdmin
  ...access.all, // all
  ...access.anonymous, // anonymous
]);

export function isForbiddenMembershipRole(role: string): boolean {
  return FORBIDDEN_MEMBERSHIP_ROLES.has(role);
}

export function findForbiddenMembershipRole(roles: readonly string[]): string | undefined {
  return roles.find(isForbiddenMembershipRole);
}

// Filters reserved roles out of the membership portion only. Callers merge the
// result with globalRoles, which is never filtered.
export function stripForbiddenMembershipRoles(roles: readonly string[]): readonly string[] {
  return roles.filter((role) => !isForbiddenMembershipRole(role));
}
