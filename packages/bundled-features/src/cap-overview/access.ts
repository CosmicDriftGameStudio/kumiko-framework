import { access, BUILT_IN_MEMBERSHIP_ROLES } from "@cosmicdrift/kumiko-framework/engine";

// Usage numbers are an operator concern by default; wider visibility is an
// explicit `usageVisibleTo` opt-in on createCapOverviewFeature. The my-caps
// screen and the query that fills its cards must carry the SAME rule, or the
// dashboard renders and every card 403s.
export const DEFAULT_CAP_USAGE_ROLES: readonly string[] = access.roles(...access.admin);

// Roles the engine itself knows (role-assignment.ts ranks). App-declared roles
// (assignableRole) only exist once the registry is composed, which is after
// this feature is defined, so they cannot be validated here.
const BUILT_IN_USAGE_VISIBLE_ROLES: ReadonlySet<string> = new Set(BUILT_IN_MEMBERSHIP_ROLES);

export function resolveCapUsageRoles(
  usageVisibleTo: readonly string[] | undefined,
): readonly string[] {
  if (usageVisibleTo === undefined) return DEFAULT_CAP_USAGE_ROLES;
  if (usageVisibleTo.length === 0) {
    throw new Error("createCapOverviewFeature: `usageVisibleTo` must not be empty.");
  }
  const unknown = usageVisibleTo.filter((role) => !BUILT_IN_USAGE_VISIBLE_ROLES.has(role));
  if (unknown.length > 0) {
    throw new Error(
      `createCapOverviewFeature: usageVisibleTo has unknown role(s) ${unknown.map((r) => `"${r}"`).join(", ")} — known roles: ${[...BUILT_IN_USAGE_VISIBLE_ROLES].join(", ")}`,
    );
  }
  return usageVisibleTo;
}
