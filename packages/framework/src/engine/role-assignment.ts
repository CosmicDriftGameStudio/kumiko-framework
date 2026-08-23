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

/** Known built-in rank only — app roles (Editor, …) are not privilege tiers. */
function knownRoleRank(role: string): number | undefined {
  return ROLE_RANKS[role];
}

export function findForbiddenRoleAssignment(
  actorRoles: readonly string[],
  assignedRoles: readonly string[],
  targetCurrentRoles: readonly string[] = [],
): string | undefined {
  const actorRank = maxRoleRank(actorRoles);
  // Assign path: fail-closed on unknown / above-actor roles.
  const forbiddenAssigned = assignedRoles.find((role) => getRoleRank(role) > actorRank);
  if (forbiddenAssigned) return forbiddenAssigned;

  // Target path: only ranked roles above the actor block (can't touch a
  // SystemAdmin). App-defined membership roles are unranked — otherwise a
  // TenantAdmin could invite Editor via invite-create but never demote them.
  const forbiddenTarget = targetCurrentRoles.find((role) => {
    const rank = knownRoleRank(role);
    return rank !== undefined && rank > actorRank;
  });
  if (forbiddenTarget) return forbiddenTarget;

  return undefined;
}
