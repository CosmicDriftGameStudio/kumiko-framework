// A tenant membership must never carry a platform-global/reserved role.
// hasAccess checks session.roles flat, with no notion of where a role came
// from — so a membership role like "SystemAdmin" merges into the session at
// login/switch and unlocks the SystemAdmin-gated, cross-tenant handler
// surface. The seed path already keeps these roles global-only (users.roles);
// this validator makes every membership-role write path enforce the same
// invariant. Derived from the framework presets so it tracks access.privileged.

import { access } from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError } from "@cosmicdrift/kumiko-framework/errors";

const FORBIDDEN_MEMBERSHIP_ROLES: ReadonlySet<string> = new Set<string>([
  ...access.privileged, // system, SystemAdmin
  ...access.all, // all
  ...access.anonymous, // anonymous
]);

export function findForbiddenMembershipRole(roles: readonly string[]): string | undefined {
  return roles.find((role) => FORBIDDEN_MEMBERSHIP_ROLES.has(role));
}

export function reservedMembershipRoleError(role: string): AccessDeniedError {
  return new AccessDeniedError({
    message: `role "${role}" is reserved and cannot be assigned to a tenant membership`,
    details: { reason: "reserved_membership_role", role },
  });
}

export function assertAssignableMembershipRoles(roles: readonly string[]): void {
  const forbidden = findForbiddenMembershipRole(roles);
  if (forbidden !== undefined) throw reservedMembershipRoleError(forbidden);
}
