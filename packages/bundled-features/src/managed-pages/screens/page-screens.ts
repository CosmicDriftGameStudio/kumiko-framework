import type {
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { PAGE_BODY_EXTENSION_NAME } from "../web/constants.ts";

// Admin authoring screens for the `page` entity. These are JSON-safe data only —
// the generic DataTable/form renderer mounts them, so no React component is
// needed. Both MUST be registered in the managed-pages feature (not in the
// app): the boot validator requires `entity: "page"` to be declared in the
// same feature as the screen. Navigation and workspace placement remain app-
// specific (`default` workspace is an app singleton) — the app points to this
// via `r.nav({ screen: "managed-pages:screen:page-list" })`.
// Cross-feature Nav→Screen is validated against the global screen QN set.

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
  // Nav/placement is app-specific (see file header) — no nav area to
  // resolve in isolation.
  dormant: true,
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
          // Publish/Unpublish: the `published` toggle here IS the publishing
          // mechanism (there is no separate one-click list action —
          // rowAction-payload cannot inject constants).
          { field: "published", span: 1 },
        ],
      },
      // Not a plain field: the body is edited as a document and a Markdown
      // body is converted on open, so the section also patches `bodyFormat`.
      {
        kind: "extension",
        title: "managed-pages:section.body",
        component: { react: { __component: PAGE_BODY_EXTENSION_NAME } },
        entityName: "page",
      },
    ],
  },
  access: { roles: ADMIN_ROLES },
};
