import type {
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";

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
  columns: ["key", "name", "isEnabled"],
  rowActions: [
    {
      kind: "navigate",
      id: "edit",
      label: "kumiko.actions.edit",
      screen: "tenant-edit",
      entityId: "id",
    },
  ],
  searchable: false,
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
