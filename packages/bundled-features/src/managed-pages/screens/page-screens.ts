import type {
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";

// Admin-Authoring-Screens für die `page`-Entity. Reine Daten (JSON-safe) —
// der generische DataTable-/Form-Renderer mountet sie, kein React-Component
// nötig. Beide MÜSSEN im managed-pages-Feature registriert werden (nicht in
// der App): der Boot-Validator verlangt, dass `entity: "page"` im selben
// Feature deklariert ist wie der Screen. Nav/Workspace bleibt App-Sache
// (placement-spezifisch, `default`-Workspace ist ein App-Singleton) — die
// App zeigt via `r.nav({ screen: "managed-pages:screen:page-list" })` darauf
// (cross-feature Nav→Screen ist gegen den globalen Screen-QN-Set validiert).

const ADMIN_ROLES = ["TenantAdmin", "SystemAdmin"] as const;

export const pageListScreen: EntityListScreenDefinition = {
  id: "page-list",
  type: "entityList",
  entity: "page",
  columns: [
    "slug",
    "lang",
    "title",
    {
      field: "published",
      renderer: {
        format: "boolean",
        trueLabel: "managed-pages:entity:page:field:published:option:true",
        falseLabel: "managed-pages:entity:page:field:published:option:false",
      },
    },
  ],
  defaultSort: { field: "slug", dir: "asc" },
  searchable: true,
  rowActions: [
    {
      kind: "navigate",
      id: "edit",
      label: "managed-pages:actions.edit",
      screen: "page-edit",
      entityId: "id",
    },
    {
      kind: "writeHandler",
      id: "delete",
      label: "managed-pages:actions.delete",
      handler: "managed-pages:write:page:delete",
      payload: { pick: ["id"] },
      confirm: "managed-pages:confirms.page-delete",
      style: "danger",
    },
  ],
  access: { roles: ADMIN_ROLES },
};

export const pageEditScreen: EntityEditScreenDefinition = {
  id: "page-edit",
  type: "entityEdit",
  entity: "page",
  layout: {
    sections: [
      {
        title: "managed-pages:section.meta",
        columns: 2,
        fields: [
          { field: "slug", span: 1 },
          { field: "lang", span: 1 },
          { field: "title", span: 2 },
          { field: "description", span: 2 },
          { field: "ogImage", span: 2 },
          // Publish/Unpublish: der `published`-Toggle hier IST der
          // Publish-Mechanismus (kein separater One-Click-List-Action —
          // rowAction-payload kann keine Konstanten injizieren).
          { field: "published", span: 1 },
        ],
      },
      {
        title: "managed-pages:section.body",
        columns: 1,
        fields: [{ field: "body", span: 1 }],
      },
    ],
  },
  access: { roles: ADMIN_ROLES },
};
