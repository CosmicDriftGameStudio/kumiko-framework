import type { AccessRule, PipelineUser } from "./types";

export function hasAccess(user: PipelineUser, access: AccessRule | undefined): boolean {
  if (!access || access.roles.length === 0) return true;
  return access.roles.some((role) => user.roles.includes(role));
}
