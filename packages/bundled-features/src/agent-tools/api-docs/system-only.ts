import { SYSTEM_ROLE } from "@cosmicdrift/kumiko-framework/engine";
import type { AccessRule } from "@cosmicdrift/kumiko-types/handlers";

/** A token never carries the system role, so such a handler is unreachable from the API. */
export function isSystemOnlyHandler(def: { readonly access: AccessRule }): boolean {
  return (
    "roles" in def.access &&
    def.access.roles.length > 0 &&
    def.access.roles.every((role) => role === SYSTEM_ROLE)
  );
}
