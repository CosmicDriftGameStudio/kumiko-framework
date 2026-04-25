import { ANONYMOUS_ROLE } from "./system-user";
import type { AccessRule, SessionUser } from "./types";

// Default-deny: a handler without an explicit AccessRule is unreachable. To
// grant access a handler must either list allowed roles or opt into
// openToAll. Leaving access undefined now returns false (previously true) —
// the registry boot-validator additionally refuses to register handlers that
// don't declare one.
//
// `openToAll` means "any authenticated user, regardless of role". Anonymous
// callers are explicitly excluded — apps that want a public endpoint must
// list `anonymous` in `roles` (e.g. `roles: ["anonymous", "customer"]`).
// Without this guard, enabling `anonymousAccess` on the server would silently
// turn every existing `openToAll: true` handler into a public endpoint.
export function hasAccess(user: SessionUser, access: AccessRule | undefined): boolean {
  if (!access) return false;
  if ("openToAll" in access) {
    if (access.openToAll !== true) return false;
    return !user.roles.includes(ANONYMOUS_ROLE);
  }
  if (access.roles.length === 0) return false;
  return access.roles.some((role) => user.roles.includes(role));
}
