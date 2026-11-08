import type { AccessRule } from "./types/handlers.ts";
import { isOpenToAllGranted } from "./types/handlers.ts";

// The hub is for editing: anyone allowed to WRITE at least one key in the group
// sees the Settings entry (write, not read). This keeps system-scope (write
// default `["system"]`) hidden from humans until the author opts in with
// write: SystemAdmin, while user-scope (write `all`) is shown to everyone.
// `all` can only be represented as openToAll in AccessRule; writes remain
// gated per key on the server.
// Access rules for navs are unioned: an openToAll nav opens the whole gate;
// otherwise roles are combined. Navs without access rules contribute nothing.
export function unionAccessRules(rules: readonly (AccessRule | undefined)[]): AccessRule {
  const roles: string[] = [];
  for (const rule of rules) {
    if (rule === undefined) continue;
    if ("openToAll" in rule) {
      if (isOpenToAllGranted(rule)) return rule;
      continue;
    }
    roles.push(...rule.roles);
  }
  return rolesToAccess(roles);
}

// `all` can only be represented as openToAll in AccessRule; writes remain gated
// per key on the server.
export function rolesToAccess(roles: readonly string[]): AccessRule {
  if (roles.includes("all"))
    return {
      openToAll: {
        reason:
          'config key declares the "all" role, so every signed-in user of the tenant may read/write it',
      },
    };
  return { roles: [...new Set(roles)] };
}
