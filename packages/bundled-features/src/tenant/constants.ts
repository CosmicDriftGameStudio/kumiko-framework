// Feature name
export const TENANT_FEATURE = "tenant" as const;

// Qualified write handler names (QN format: scope:type:name)
export const TenantHandlers = {
  create: "tenant:write:create",
  update: "tenant:write:update",
  disable: "tenant:write:disable",
  addMember: "tenant:write:add-member",
  removeMember: "tenant:write:remove-member",
  updateMemberRoles: "tenant:write:update-member-roles",
} as const;

// Qualified query handler names (QN format: scope:type:name)
export const TenantQueries = {
  me: "tenant:query:me",
  list: "tenant:query:list",
  memberships: "tenant:query:memberships",
  members: "tenant:query:members",
  activeTenantIds: "tenant:query:active-tenant-ids",
  resolveUserIds: "tenant:query:resolve-user-ids",
} as const;

// Error codes
export const TenantErrors = {
  membershipNotFound: "membership_not_found",
  membershipAlreadyExists: "membership_already_exists",
} as const;
