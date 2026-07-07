import type {
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";

// Cross-tenant platform admin view of the user identity. Because the user
// feature runs with `r.systemScope()`, the entityList query returns every
// user across all tenants — the SystemAdmin platform roster. Both screens are
// SystemAdmin-gated and stay inert until an app navs them (no auto-nav).

export const userListScreen: EntityListScreenDefinition = {
  id: "user-list",
  type: "entityList",
  entity: "user",
  columns: ["email", "displayName", "status", "emailVerified"],
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
  // ponytail: screen searchable but email is encrypted PII — list search uses non-encrypted columns only.
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
        fields: ["email", "displayName", "locale", "emailVerified"],
      },
    ],
  },
  allowDelete: false,
  access: { roles: ["SystemAdmin"] },
};
