// Pure string constants, client-safe because they live under web/ (see
// auth-email-password/web/constants.ts); server code may import them too.

// Feature name
export const TENANT_FEATURE = "tenant" as const;

export const MEMBERS_SCREEN_ID = "members" as const;

export const INVITE_CREATE_SCREEN_ID = "invite-create" as const;

export const MEMBER_ROLES_EDIT_SCREEN_ID = "member-roles-edit" as const;

/** Client column-renderer for the /members screen's status column — see
 *  `screen.columns[].renderer.react.__component` in screens.ts and
 *  `tenantClient()`'s `columnRenderers` map. */
export const MEMBER_STATUS_CELL_COMPONENT = "MemberStatusCell" as const;

/** Client column-renderer for the /members screen's roles column (joins the
 *  `roles: readonly string[]` field into one cell) — same wiring as above. */
export const MEMBER_ROLES_CELL_COMPONENT = "MemberRolesCell" as const;

/** Closed allowlist for invite-role picker — never free text (escalation guard). */
// Admin (rank 2) shares the invite-create screen with TenantAdmin — TenantAdmin
// must not appear here or Admin sees an unassignable option (fw#2414).
export const DEFAULT_INVITE_ROLE_OPTIONS = ["User", "Editor", "Admin"] as const;
// Full rank list for memberRolesEditScreen: it is prefilled with a member's
// *current* roles, so it must represent every rank a membership can hold,
// including TenantAdmin (fw#2452). The screen hides what the caller may not
// assign via TenantQueries.memberRoleAvailability.
export const OWNER_INVITE_ROLE_OPTIONS = [
  "User",
  "Member",
  "Editor",
  "Admin",
  "TenantAdmin",
] as const;

// Qualified write handler names (QN format: scope:type:name)
export const TenantHandlers = {
  create: "tenant:write:create",
  update: "tenant:write:update",
  disable: "tenant:write:disable",
  enable: "tenant:write:enable",
  addMember: "tenant:write:add-member",
  removeMember: "tenant:write:remove-member",
  updateMemberRoles: "tenant:write:update-member-roles",
  cancelInvitation: "tenant:write:cancel-invitation",
} as const;

// Qualified query handler names (QN format: scope:type:name)
export const TenantQueries = {
  me: "tenant:query:me",
  list: "tenant:query:list",
  memberships: "tenant:query:memberships",
  members: "tenant:query:members",
  // Label source for `user:user` reference columns — see
  // REFERENCE_LOOKUP_SOURCES in the framework's ui-types.
  memberDirectory: "tenant:query:member-directory",
  // Label source for `tenant:tenant` reference columns — see
  // REFERENCE_LOOKUP_SOURCES in the framework's ui-types.
  tenantDirectory: "tenant:query:tenant-directory",
  activeTenantIds: "tenant:query:active-tenant-ids",
  resolveUserIds: "tenant:query:resolve-user-ids",
  // Pending Invitations für den aktuellen Tenant (Admin-UI-Liste).
  invitations: "tenant:query:invitations",
  // Combined active-members + pending-invitations list backing /members.
  teamList: "tenant:query:team:list",
  // Per-role assignability for the caller, mirrors the rank rule of updateMemberRoles.
  memberRoleAvailability: "tenant:query:member-role-availability",
} as const;

// Error codes
export const TenantErrors = {
  membershipNotFound: "membership_not_found",
  membershipAlreadyExists: "membership_already_exists",
  lastTenantAdmin: "last_tenant_admin",
  invitationSuperseded: "invitation_superseded",
  crossTenantMembershipDenied: "cross_tenant_membership_denied",
} as const;
