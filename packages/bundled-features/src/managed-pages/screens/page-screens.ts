import type { EntityListScreenDefinition } from "@cosmicdrift/kumiko-framework/engine";
import type { CustomScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { PAGE_EDIT_SCREEN_ID, PAGE_LIST_SCREEN_ID } from "../web/constants.ts";

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
  id: PAGE_LIST_SCREEN_ID,
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
  createScreen: PAGE_EDIT_SCREEN_ID,
  rowActions: [
    {
      kind: "navigate",
      id: "edit",
      label: "managed-pages:actions.edit",
      screen: PAGE_EDIT_SCREEN_ID,
      entityId: "id",
      // The generated list opened the entityEdit form on a row click; the custom mask has to say so.
      rowClick: true,
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

// The page mask sits on the shared editor workbench (settings rail beside an edit/preview body),
// which no generated form screen offers; the client plugin mounts it under this id.
export const pageEditScreen: CustomScreenDefinition = {
  id: PAGE_EDIT_SCREEN_ID,
  type: "custom",
  renderer: { react: { __component: PAGE_EDIT_SCREEN_ID } },
  description:
    "Edit or create one managed page: body with live preview as visitors see it (desktop and mobile width) beside the page settings, saved in one step.",
  listScreenId: PAGE_LIST_SCREEN_ID,
  access: { roles: ADMIN_ROLES },
  dormant: true,
};
