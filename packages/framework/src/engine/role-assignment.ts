const ROLE_RANKS: Readonly<Record<string, number>> = {
  User: 0,
  // Matches DEFAULT_INVITE_ROLE_OPTIONS — must stay ranked or invite UI fails closed.
  Editor: 1,
  Admin: 2,
  TenantAdmin: 3,
  SystemAdmin: 4,
  system: 5,
};

// Unknown roles: +∞ on the assigned path (cannot grant what we don't know),
// -1 on the actor path (cannot elevate via an unrecognized self-role).
function roleRankOr(role: string, unknownRank: number): number {
  return ROLE_RANKS[role] ?? unknownRank;
}

function getRoleRank(role: string): number {
  return roleRankOr(role, Number.POSITIVE_INFINITY);
}

function maxRoleRank(roles: readonly string[]): number {
  if (roles.length === 0) return -1;
  return Math.max(...roles.map((role) => roleRankOr(role, -1)));
}

/** Known built-in rank only — unranked app roles (Billing, …) are not privilege tiers. */
function knownRoleRank(role: string): number | undefined {
  return ROLE_RANKS[role];
}

export function findForbiddenRoleAssignment(
  actorRoles: readonly string[],
  assignedRoles: readonly string[],
  // Required so callers cannot accidentally disable the downgrade/
  // takeover guard by omitting the third argument (new users: pass []).
  targetCurrentRoles: readonly string[],
): string | undefined {
  const actorRank = maxRoleRank(actorRoles);
  // Assign path: fail-closed on unknown / above-actor roles.
  const forbiddenAssigned = assignedRoles.find((role) => getRoleRank(role) > actorRank);
  if (forbiddenAssigned) return forbiddenAssigned;

  // Target path: only ranked roles above the actor block (can't touch a
  // SystemAdmin). Unranked app roles are ignored here so members with only
  // those roles don't freeze on demotion/updates — the assign path still
  // rejects unranked roles fail-closed.
  const forbiddenTarget = targetCurrentRoles.find((role) => {
    const rank = knownRoleRank(role);
    return rank !== undefined && rank > actorRank;
  });
  if (forbiddenTarget) return forbiddenTarget;

  return undefined;
}
