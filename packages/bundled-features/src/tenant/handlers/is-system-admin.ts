import { access, type SessionUser } from "@cosmicdrift/kumiko-framework/engine";

export function isSystemAdmin(user: Pick<SessionUser, "roles">): boolean {
  return access.systemAdmin.some((role) => user.roles.includes(role));
}
