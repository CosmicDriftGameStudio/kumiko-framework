import { AuthHandlers } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/constants";
import {
  access,
  type EntityEditScreenDefinition,
  type EntityListScreenDefinition,
  type ScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  DEFAULT_INVITE_ROLE_OPTIONS,
  INVITE_CREATE_SCREEN_ID,
  MEMBER_ROLES_CELL_COMPONENT,
  MEMBER_STATUS_CELL_COMPONENT,
  MEMBERS_SCREEN_ID,
  TenantHandlers,
  TenantQueries,
} from "./constants";

// Cross-tenant SystemAdmin platform view of the tenants themselves. The tenant
// feature runs with `r.systemScope()`, so the entityList returns every tenant.
// Both screens are SystemAdmin-gated and inert until an app navs them.
//
// Backed by the entity-convention handlers registered in feature.ts
// (tenant:query:tenant:{list,detail}, tenant:write:tenant:update). The legacy
// `tenant:query:list` / `tenant:write:update` handlers stay for existing
// callers — these screens bind to the entity-suffixed QNs by convention.

export const tenantListScreen: EntityListScreenDefinition = {
  id: "tenant-list",
  type: "entityList",
  entity: "tenant",
  columns: ["key", "name", "status", "isEnabled"],
  rowActions: [
    {
      kind: "navigate",
      id: "edit",
      label: "kumiko.actions.edit",
      screen: "tenant-edit",
      entityId: "id",
    },
  ],
  defaultSort: { field: "name", dir: "asc" },
  searchable: true,
  access: { roles: ["SystemAdmin"] },
};

export const tenantEditScreen: EntityEditScreenDefinition = {
  id: "tenant-edit",
  type: "entityEdit",
  entity: "tenant",
  layout: {
    // `key` is the unique admin-URL slug — shown in the list, not editable here.
    sections: [{ columns: 2, fields: ["name", "isEnabled"] }],
  },
  // No raw tenant creation (onboarding owns membership/owner setup) and no
  // hard delete (no tenant:write:tenant:delete — disable via isEnabled instead).
  allowCreate: false,
  allowDelete: false,
  access: { roles: ["SystemAdmin"] },
};

// Tenant-admin team UI (§2.6 bundled-features-screen-standardisierung.md):
// one list, active members and pending invitations merged into a single
// `status` column, pendings narrowed via the `status` facet instead of a
// separate card. Backed by tenant:query:team:list (no role-edit — that
// stays on updateMemberRoles, SystemAdmin-only, see feature.ts).
//
// `inviteScreen` gates the toolbar's "invite" drawer button: it targets
// `inviteCreateScreen`, whose write-handler is owned by auth-email-password
// and only registered when that feature's `invite` option is configured
// (see feature.ts's `TenantFeatureOptions`). `tenant` has no compile-time way
// to know whether an app configured that — the flag defaults to false so
// `createTenantFeature()` alone (no auth-email-password, or auth-email-password
// without `invite`) keeps booting; apps that DO configure invite opt in.
export function createMembersScreen(options?: {
  readonly inviteScreen?: boolean;
}): ScreenDefinition {
  return {
    id: MEMBERS_SCREEN_ID,
    type: "projectionList",
    query: TenantQueries.teamList,
    columns: [
      { field: "email", label: "tenant.members.col.email" },
      {
        field: "roles",
        label: "tenant.members.col.roles",
        renderer: { react: { __component: MEMBER_ROLES_CELL_COMPONENT } },
      },
      {
        field: "status",
        label: "tenant.members.col.status",
        renderer: { react: { __component: MEMBER_STATUS_CELL_COMPONENT } },
      },
      { field: "createdAt", label: "tenant.members.col.created" },
      { field: "lastSeenAt", label: "tenant.members.col.lastActivity" },
    ],
    defaultSort: { field: "createdAt", dir: "desc" },
    searchable: true,
    facets: [
      {
        field: "status",
        type: "select",
        label: "tenant.members.filter.status",
        options: [
          { value: "active", label: "tenant.members.filter.status.option.active" },
          { value: "pending", label: "tenant.members.filter.status.option.pending" },
        ],
      },
    ],
    rowActions: [
      {
        kind: "writeHandler",
        id: "cancel-invitation",
        label: "tenant.members.cancel",
        handler: TenantHandlers.cancelInvitation,
        payload: { map: { invitationId: "id" } },
        confirm: "tenant.members.cancel.confirm",
        style: "danger",
        visible: { field: "status", eq: "pending" },
      },
    ],
    ...(options?.inviteScreen && {
      toolbarActions: [
        {
          kind: "drawer",
          id: "invite",
          label: "tenant.members.invite.title",
          screen: INVITE_CREATE_SCREEN_ID,
          style: "primary",
        },
      ],
    }),
    access: { roles: access.admin },
  } satisfies ScreenDefinition;
}

// Drawer target for membersScreen's "invite" toolbar action — kind:"drawer"
// only resolves same-feature actionForm screens, so this lives here even
// though its handler is owned by auth-email-password. Not `r.nav()`'d: the
// only entry point is the drawer button on /members. Only registered by
// feature.ts when `TenantFeatureOptions.inviteScreen` is set — see
// createMembersScreen's doc comment above for why.
export const inviteCreateScreen = {
  id: INVITE_CREATE_SCREEN_ID,
  type: "actionForm",
  handler: AuthHandlers.inviteCreate,
  fields: {
    email: { type: "text", required: true, format: "email" },
    role: { type: "select", options: DEFAULT_INVITE_ROLE_OPTIONS, required: true },
  },
  layout: {
    sections: [{ fields: ["email", "role"] }],
  },
  submitLabel: "tenant.members.invite.submit",
  access: { roles: access.admin },
} satisfies ScreenDefinition;
