import type { AssignableAppRoles } from "@cosmicdrift/kumiko-framework/engine";
import { OWNER_INVITE_ROLE_OPTIONS } from "./constants.js";

export function memberRoleOptions(assignableAppRoles: AssignableAppRoles): readonly string[] {
  return [...OWNER_INVITE_ROLE_OPTIONS, ...assignableAppRoles.keys()];
}
