import { access, defineEntityDetailHandler } from "@cosmicdrift/kumiko-framework/engine";
import { userEntity } from "../schema/user";

// Only SystemAdmins can read arbitrary users. Tenant-level "Admin" does NOT
// grant this — the user feature is tenant-agnostic, and an Admin's scope is
// bound to their own tenant's memberships (served by the tenant feature).
export const detailQuery = defineEntityDetailHandler("user", userEntity, {
  access: { roles: access.systemAdmin },
});
