import { ROLES } from "../auth/roles.js";
import { isForbiddenMembershipRole } from "./membership-roles.js";

const PLATFORM_ROLE_NAMES: ReadonlySet<string> = new Set<string>(Object.values(ROLES));

// Prototype-free rank table — Object literals leak Object.prototype
// (`constructor`, `toString`, …) into `ROLE_RANKS[role]` lookups and turn
// Math.max into NaN, which fails every `rank > actorRank` check open.
const ROLE_RANKS = new Map<string, number>([
  ["User", 0],
  // Default seed role — unranked it would fail closed and never be assignable.
  ["Member", 0],
  // Matches DEFAULT_INVITE_ROLE_OPTIONS — must stay ranked or invite UI fails closed.
  ["Editor", 1],
  ["Admin", 2],
  ["TenantAdmin", 3],
  ["SystemAdmin", 4],
  ["system", 5],
]);

export type AssignableFromRole =
  | "User"
  | "Member"
  | "Editor"
  | "Admin"
  | "TenantAdmin"
  | "SystemAdmin";

/** App role → lowest built-in role allowed to assign it. */
export type AssignableAppRoles = ReadonlyMap<string, AssignableFromRole>;

// App roles are ordinary, non-privileged tiers: whoever may manage members
// (access.admin) may grant them; an app raises the bar via assignableFrom.
export const DEFAULT_APP_ROLE_ASSIGNABLE_FROM: AssignableFromRole = "Admin";

const NO_ASSIGNABLE_APP_ROLES: AssignableAppRoles = new Map();

const ASSIGNABLE_FROM_ROLES: ReadonlySet<string> = new Set<AssignableFromRole>([
  "User",
  "Member",
  "Editor",
  "Admin",
  "TenantAdmin",
  "SystemAdmin",
]);

function isAssignableFromRole(value: unknown): value is AssignableFromRole {
  return typeof value === "string" && ASSIGNABLE_FROM_ROLES.has(value);
}

export function assignableAppRolesFromUsages(
  usages: readonly { entityName: string; options?: Record<string, unknown> | undefined }[],
): AssignableAppRoles {
  const result = new Map<string, AssignableFromRole>();
  for (const usage of usages) {
    const role = usage.entityName;
    if (role === "") {
      throw new Error("assignableRole: role name must not be empty");
    }
    // Platform roles (TenantOwner, DataProtectionOfficer) gate handlers that
    // TenantAdmin/Admin cannot reach — declaring one would let an Admin
    // self-grant it, so they stay out of reach of app declarations.
    if (ROLE_RANKS.has(role) || PLATFORM_ROLE_NAMES.has(role)) {
      throw new Error(`assignableRole: "${role}" is a built-in role and cannot be redeclared`);
    }
    if (isForbiddenMembershipRole(role)) {
      throw new Error(
        `assignableRole: "${role}" is a reserved role and cannot be a membership role`,
      );
    }
    const declaredAssignableFrom = usage.options?.["assignableFrom"];
    if (declaredAssignableFrom !== undefined && !isAssignableFromRole(declaredAssignableFrom)) {
      throw new Error(
        `assignableRole: "${role}" has invalid assignableFrom, expected one of ${[...ASSIGNABLE_FROM_ROLES].join(", ")}`,
      );
    }
    const assignableFrom = declaredAssignableFrom ?? DEFAULT_APP_ROLE_ASSIGNABLE_FROM;
    const existing = result.get(role);
    if (existing !== undefined && existing !== assignableFrom) {
      throw new Error(
        `assignableRole: "${role}" is declared with conflicting assignableFrom (${existing} vs ${assignableFrom})`,
      );
    }
    result.set(role, assignableFrom);
  }
  return result;
}

/** True when `actorRole` ranks at least as high as the role an app role is assignable from. */
export function isAssignableByRole(
  assignableFrom: AssignableFromRole,
  actorRole: AssignableFromRole,
): boolean {
  return getRoleRank(assignableFrom) <= getRoleRank(actorRole);
}

// Unknown roles: +∞ on the assigned path (cannot grant what we don't know, unless declared),
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

// Built-ins win: a declaration can never re-tier a built-in role.
function requiredAssignRank(role: string, assignableAppRoles: AssignableAppRoles): number {
  const builtIn = ROLE_RANKS.get(role);
  if (builtIn !== undefined) return builtIn;
  const assignableFrom = assignableAppRoles.get(role);
  return assignableFrom === undefined ? Number.POSITIVE_INFINITY : getRoleRank(assignableFrom);
}

export function findForbiddenRoleAssignment(
  actorRoles: readonly string[],
  assignedRoles: readonly string[],
  // Required so callers cannot accidentally disable the downgrade/
  // takeover guard by omitting the third argument (new users: pass []).
  targetCurrentRoles: readonly string[],
  assignableAppRoles: AssignableAppRoles = NO_ASSIGNABLE_APP_ROLES,
): string | undefined {
  const actorRank = maxRoleRank(actorRoles);
  // Assign path: fail-closed on unknown / above-actor roles — except unranked
  // app roles the target already holds (round-trip restore after strip).
  const forbiddenAssigned = assignedRoles.find((role) => {
    if (requiredAssignRank(role, assignableAppRoles) <= actorRank) return false;
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
