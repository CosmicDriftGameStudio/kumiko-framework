// Prototype-free rank table — Object literals leak Object.prototype
// (`constructor`, `toString`, …) into `ROLE_RANKS[role]` lookups and turn
// Math.max into NaN, which fails every `rank > actorRank` check open.
const ROLE_RANKS = new Map<string, number>([
  ["User", 0],
  // Matches DEFAULT_INVITE_ROLE_OPTIONS — must stay ranked or invite UI fails closed.
  ["Editor", 1],
  ["Admin", 2],
  ["TenantAdmin", 3],
  ["SystemAdmin", 4],
  ["system", 5],
]);

// Unknown roles: +∞ on the assigned path (cannot grant what we don't know),
// -1 on the actor path (cannot elevate via an unrecognized self-role).
function roleRankOr(role: string, unknownRank: number): number {
  return ROLE_RANKS.get(role) ?? unknownRank;
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
  return ROLE_RANKS.get(role);
}

export function findForbiddenRoleAssignment(
  actorRoles: readonly string[],
  assignedRoles: readonly string[],
  // Required so callers cannot accidentally disable the downgrade/
  // takeover guard by omitting the third argument (new users: pass []).
  targetCurrentRoles: readonly string[],
): string | undefined {
  const actorRank = maxRoleRank(actorRoles);
  // Assign path: fail-closed on unknown / above-actor roles — except unranked
  // app roles the target already holds (round-trip restore after strip).
  const forbiddenAssigned = assignedRoles.find((role) => {
    if (getRoleRank(role) <= actorRank) return false;
    if (knownRoleRank(role) === undefined && targetCurrentRoles.includes(role)) return false;
    return true;
  });
  // Empty string is unknown (rank +∞) but falsy — must not use truthiness.
  if (forbiddenAssigned !== undefined) return forbiddenAssigned;

  // Target path: only ranked roles above the actor block (can't touch a
  // SystemAdmin). Unranked app roles are ignored here so members with only
  // those roles don't freeze on demotion/updates — the assign path still
  // rejects *new* unranked roles fail-closed.
  const forbiddenTarget = targetCurrentRoles.find((role) => {
    const rank = knownRoleRank(role);
    return rank !== undefined && rank > actorRank;
  });
  if (forbiddenTarget !== undefined) return forbiddenTarget;

  return undefined;
}
