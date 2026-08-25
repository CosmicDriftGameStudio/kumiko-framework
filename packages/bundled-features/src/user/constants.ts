// @runtime client
// Feature name
export const USER_FEATURE = "user" as const;

/** Assignable global (cross-tenant) roles on user.roles — SystemAdmin is the
 *  platform operator. Membership roles (TenantAdmin/Admin/User/…) live on
 *  tenant-membership, not here. */
export const GLOBAL_ROLE_OPTIONS = ["SystemAdmin"] as const;

// Qualified write handler names. Handlers carry the "user:" entity prefix so
// field-level access rules (passwordHash system-only etc.) are wired up.
export const UserHandlers = {
  create: "user:write:user:create",
  update: "user:write:user:update",
} as const;

// Qualified query handler names
export const UserQueries = {
  me: "user:query:user:me",
  detail: "user:query:user:detail",
  list: "user:query:user:list",
  findForAuth: "user:query:user:find-for-auth",
} as const;

// Error codes
export const UserErrors = {
  emailAlreadyExists: "email_already_exists",
  cannotEditOtherUser: "cannot_edit_other_user",
  cannotModifyGlobalRoles: "cannot_modify_global_roles",
  cannotDemoteLastSystemAdmin: "cannot_demote_last_system_admin",
  roleElevationForbidden: "role_elevation_forbidden",
} as const;
