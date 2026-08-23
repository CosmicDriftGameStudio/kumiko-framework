const ROLE_RANKS = {
  User: 0,
  Admin: 1,
  TenantAdmin: 2,
  SystemAdmin: 3,
} as const;

function maxRoleRank(roles: readonly string[]): number {
  return Math.max(0, ...roles.map((role) => ROLE_RANKS[role as keyof typeof ROLE_RANKS] ?? 0));
}

export function findForbiddenRoleAssignment(
  actorRoles: readonly string[],
  assignedRoles: readonly string[],
): string | undefined {
  const actorRank = maxRoleRank(actorRoles);
  return assignedRoles.find(
    (role) => (ROLE_RANKS[role as keyof typeof ROLE_RANKS] ?? 0) > actorRank,
  );
}
