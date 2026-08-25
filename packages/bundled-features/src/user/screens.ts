import type {
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";

// Cross-tenant platform admin view of the user identity. Because the user
// feature runs with `r.systemScope()`, the entityList query returns every
// user across all tenants — the SystemAdmin platform roster. Both screens are
// SystemAdmin-gated and stay inert until an app navs them (no auto-nav).
//
// `roles` is a multiSelect (global SystemAdmin). `tenants` is a derived field
// filled by the list handler from memberships — without it the roster is
// unusable for ops (waitlist signups look like platform users with no context).

export const userListScreen: EntityListScreenDefinition = {
  id: "user-list",
  type: "entityList",
  entity: "user",
  columns: ["email", "displayName", "roles", "tenants", "status", "emailVerified"],
  rowActions: [
    {
      kind: "navigate",
      id: "edit",
      label: "kumiko.actions.edit",
      screen: "user-edit",
      entityId: "id",
    },
  ],
  defaultSort: { field: "status", dir: "asc" },
  // Search uses SYSTEM_TENANT_ID for systemScope lists (see event-store-executor-read).
  // Apps must boot a user search index on that tenant (offlot: bootWaitlistSearch).
  searchable: true,
  access: { roles: ["SystemAdmin"] },
};

export const userEditScreen: EntityEditScreenDefinition = {
  id: "user-edit",
  type: "entityEdit",
  entity: "user",
  layout: {
    sections: [
      {
        columns: 2,
        fields: ["email", "displayName", "locale", "timezone", "emailVerified", "roles"],
      },
    ],
  },
  allowDelete: false,
  access: { roles: ["SystemAdmin"] },
};
