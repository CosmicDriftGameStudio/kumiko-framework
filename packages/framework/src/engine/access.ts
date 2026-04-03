import type { AccessRule, SessionUser } from "./types";

export function hasAccess(user: SessionUser, access: AccessRule | undefined): boolean {
  if (!access || access.roles.length === 0) return true;
  return access.roles.some((role) => user.roles.includes(role));
}
