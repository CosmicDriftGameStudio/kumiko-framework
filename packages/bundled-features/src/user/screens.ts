import type {
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";

// Cross-tenant platform admin view of the user identity. Because the user
// feature runs with `r.systemScope()`, the entityList query returns every
// user across all tenants — the SystemAdmin platform roster. Both screens are
// SystemAdmin-gated and stay inert until an app navs them (no auto-nav).
//
// Field labels come from the renderer's humanizeSlug fallback (no i18n keys
// registered) — "Display Name", "Email Verified" etc. Apps can override via
// their own translations under the `user:entity:user:field:*` convention.

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
  // No SearchAdapter assumption: search is opt-in per app infra, not a
  // universal default for a bundled screen.
  searchable: false,
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
  // `roles` is deliberately NOT editable here: it is a raw JSON text column
  // (`["SystemAdmin"]`) — a free-text input would let a typo corrupt the
  // privilege column on a live platform. Role management needs a dedicated
  // surface; the list still shows status for triage.
  //
  // Create dispatches user:write:user:create (email + displayName required —
  // both in the form). Delete is suppressed: there is no user:write:user:delete
  // — user removal is the GDPR status/forget flow, not a hard delete.
  allowDelete: false,
  access: { roles: ["SystemAdmin"] },
};
