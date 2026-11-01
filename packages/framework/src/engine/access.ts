import type { AccessRule } from "@cosmicdrift/kumiko-types/handlers";
import { isAnySignedInGranted, isOpenToAllGranted } from "@cosmicdrift/kumiko-types/handlers";
import { ANONYMOUS_ROLE } from "./system-user.ts";
import type { SessionUser } from "./types/index.ts";

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
// `anySignedIn` widens such a public rule to every signed-in caller instead of
// the listed roles only.
export function hasAccess(
  user: Pick<SessionUser, "roles">,
  access: AccessRule | undefined,
): boolean {
  if (!access) return false;
  if ("openToAll" in access) {
    if (!isOpenToAllGranted(access)) return false;
    return !user.roles.includes(ANONYMOUS_ROLE);
  }
  if (access.roles.length === 0) return false;
  if (isAnySignedInGranted(access) && !user.roles.includes(ANONYMOUS_ROLE)) return true;
  return access.roles.some((role) => user.roles.includes(role));
}
