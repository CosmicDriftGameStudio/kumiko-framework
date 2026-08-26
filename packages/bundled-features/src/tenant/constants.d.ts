export declare const TENANT_FEATURE: "tenant";
export declare const MEMBERS_SCREEN_ID: "members";
export declare const INVITE_CREATE_SCREEN_ID: "invite-create";
export declare const MEMBER_ROLES_EDIT_SCREEN_ID: "member-roles-edit";
/** Client column-renderer for the /members screen's status column — see
 *  `screen.columns[].renderer.react.__component` in screens.ts and
 *  `tenantClient()`'s `columnRenderers` map. */
export declare const MEMBER_STATUS_CELL_COMPONENT: "MemberStatusCell";
/** Client column-renderer for the /members screen's roles column (joins the
 *  `roles: readonly string[]` field into one cell) — same wiring as above. */
export declare const MEMBER_ROLES_CELL_COMPONENT: "MemberRolesCell";
/** Closed allowlist for invite-role picker — never free text (escalation guard). */
export declare const DEFAULT_INVITE_ROLE_OPTIONS: readonly ["User", "Editor", "Admin", "TenantAdmin"];
export declare const TenantHandlers: {
    readonly create: "tenant:write:create";
    readonly update: "tenant:write:update";
    readonly disable: "tenant:write:disable";
    readonly enable: "tenant:write:enable";
    readonly addMember: "tenant:write:add-member";
    readonly removeMember: "tenant:write:remove-member";
    readonly updateMemberRoles: "tenant:write:update-member-roles";
    readonly cancelInvitation: "tenant:write:cancel-invitation";
};
export declare const TenantQueries: {
    readonly me: "tenant:query:me";
    readonly list: "tenant:query:list";
    readonly memberships: "tenant:query:memberships";
    readonly members: "tenant:query:members";
    readonly activeTenantIds: "tenant:query:active-tenant-ids";
    readonly resolveUserIds: "tenant:query:resolve-user-ids";
    readonly invitations: "tenant:query:invitations";
    readonly teamList: "tenant:query:team:list";
};
export declare const TenantErrors: {
    readonly membershipNotFound: "membership_not_found";
    readonly membershipAlreadyExists: "membership_already_exists";
    readonly lastTenantAdmin: "last_tenant_admin";
};
//# sourceMappingURL=constants.d.ts.map