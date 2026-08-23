const ROLE_RANKS: Readonly<Record<string, number>> = {
  User: 0,
  Admin: 1,
  TenantAdmin: 2,
  SystemAdmin: 3,
};

function getRoleRank(role: string): number {
  return ROLE_RANKS[role] ?? Number.POSITIVE_INFINITY;
}

function maxRoleRank(roles: readonly string[]): number {
  if (roles.length === 0) return -1;
  return Math.max(...roles.map((role) => ROLE_RANKS[role] ?? -1));
}

export function findForbiddenRoleAssignment(
  actorRoles: readonly string[],
  assignedRoles: readonly string[],
  targetCurrentRoles: readonly string[] = [],
): string | undefined {
  const actorRank = maxRoleRank(actorRoles);
  const forbiddenAssigned = assignedRoles.find((role) => getRoleRank(role) > actorRank);
  if (forbiddenAssigned) return forbiddenAssigned;

  const forbiddenTarget = targetCurrentRoles.find((role) => getRoleRank(role) > actorRank);
  if (forbiddenTarget) return forbiddenTarget;

  return undefined;
}
