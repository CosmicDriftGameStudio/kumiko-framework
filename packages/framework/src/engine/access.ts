import type { AccessRule, SessionUser } from "./types";

// Default-deny: a handler without an explicit AccessRule is unreachable. To
// grant access a handler must either list allowed roles or opt into
// openToAll. Leaving access undefined now returns false (previously true) —
// the registry boot-validator additionally refuses to register handlers that
// don't declare one.
export function hasAccess(user: SessionUser, access: AccessRule | undefined): boolean {
  if (!access) return false;
  if ("openToAll" in access) return access.openToAll === true;
  if (access.roles.length === 0) return false;
  return access.roles.some((role) => user.roles.includes(role));
}
