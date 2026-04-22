import { access, defineEntityQueryHandler } from "@kumiko/framework/engine";
import { userEntity } from "../user-entity";

// System-wide user listing is SystemAdmin-only. Tenant admins list their
// members via the tenant feature (which scopes by membership, not globally).
export const listQuery = defineEntityQueryHandler("user:list", userEntity, {
  access: { roles: access.systemAdmin },
});
