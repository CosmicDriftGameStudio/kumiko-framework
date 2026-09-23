// Reserved/platform-global roles must never reach a session via a tenant
// membership. hasAccess checks session.roles flat, with no notion of origin,
// so a membership role like "SystemAdmin" would unlock the SystemAdmin-gated
// cross-tenant surface. The write paths enforce this at command time
// (assertAssignableMembershipRoles), but command-time validation does not
// survive a projection rebuild: replaying a stored membership event goes
// through the apply path, not the handler. stripForbiddenMembershipRoles is
// the read-time backstop — applied at every JWT mint that derives roles from
// membership, it neutralises a resurrected role. buildSessionRoles applies a
// matching strip (anonymous/all only) to globalRoles, where SystemAdmin
// legitimately lives.

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
// result with globalRoles, which buildSessionRoles filters separately below.
export function stripForbiddenMembershipRoles(roles: readonly string[]): readonly string[] {
  return roles.filter((role) => !isForbiddenMembershipRole(role));
}

// "anonymous"/"all" are never legitimate global roles; system/SystemAdmin stay.
const NON_MINTABLE_GLOBAL_ROLES: ReadonlySet<string> = new Set<string>([
  ...access.all,
  ...access.anonymous,
]);

function stripNonMintableGlobalRoles(roles: readonly string[]): readonly string[] {
  return roles.filter((role) => !NON_MINTABLE_GLOBAL_ROLES.has(role));
}

// Single mint path for session roles: merges globalRoles with the stripped
// membership portion and dedupes. Every place that builds a session's roles
// from a membership should go through this instead of repeating
// `new Set([...globalRoles, ...stripForbiddenMembershipRoles(x)])` — a new
// mint site that forgets the strip is exactly the bug class this guards
// against.
export function buildSessionRoles(
  globalRoles: readonly string[],
  membershipRoles: readonly string[],
): readonly string[] {
  return Array.from(
    new Set([
      ...stripNonMintableGlobalRoles(globalRoles),
      ...stripForbiddenMembershipRoles(membershipRoles),
    ]),
  );
}
