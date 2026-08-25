// @runtime client
// Pure string constants — `@runtime client` so browser code (e.g. the
// MemberStatusCell column renderer) can import them too (see
// auth-email-password/constants.ts for the rationale). Runtime imports
// client → server can keep using them as well.

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
export const DEFAULT_INVITE_ROLE_OPTIONS = ["User", "Editor", "Admin", "TenantAdmin"] as const;

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
  activeTenantIds: "tenant:query:active-tenant-ids",
  resolveUserIds: "tenant:query:resolve-user-ids",
  // Pending Invitations für den aktuellen Tenant (Admin-UI-Liste).
  invitations: "tenant:query:invitations",
  // Combined active-members + pending-invitations list backing /members.
  teamList: "tenant:query:team:list",
} as const;

// Error codes
export const TenantErrors = {
  membershipNotFound: "membership_not_found",
  membershipAlreadyExists: "membership_already_exists",
  lastTenantAdmin: "last_tenant_admin",
} as const;
