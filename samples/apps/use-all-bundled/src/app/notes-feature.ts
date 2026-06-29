// @runtime dev
//
// Dev-/screenshot-only host entity for the tags feature. A plain `note` knows
// NOTHING about tags (no column, no awareness) — yet its edit screen hosts the
// drop-in <TagSection> and its list hosts the drop-in <TagFilter>, proving the
// "tag any object" promise on a real, bootable screen.
//
// Deliberately NOT in src/run-config.ts APP_FEATURES: that set is bundled-only
// (schema/generate.ts FEATURE_IMPORT_REGISTRY + check-coverage gate it). Like
// appScreensFeature, this app-owned feature is mounted only in the dev server
// (src/app/server.ts), where runDevApp dev-pushes its table into the ephemeral
// DB. Nothing here ships to prod / the schema pipeline.

import {
  TAGS_COLUMN_RENDERER_NAME,
  TAGS_FILTER_EXTENSION_NAME,
  TAGS_SECTION_EXTENSION_NAME,
} from "@cosmicdrift/kumiko-bundled-features/tags";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
  type EntityEditScreenDefinition,
  type EntityListScreenDefinition,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";

const ADMIN_ACCESS = { roles: ["TenantAdmin", "SystemAdmin"] } as const;

// A plain entity — no tag column, no tag awareness.
export const noteEntity = createEntity({
  table: "read_demo_notes",
  fields: {
    title: createTextField({ required: true, maxLength: 200 }),
  },
});

const noteListScreen: EntityListScreenDefinition = {
  id: "note-list",
  type: "entityList",
  entity: "note",
  // "tags" is a virtual column (not a note field): the drop-in TagsCell renderer
  // draws the row's tag chips inline. Reusable on any entityList, zero host schema.
  columns: [
    "title",
    {
      field: "tags",
      label: "Tags",
      renderer: { react: { __component: TAGS_COLUMN_RENDERER_NAME } },
    },
  ],
  searchable: true,
  // The drop-in tag filter — narrows THIS list to the notes carrying the picked
  // tags, via the renderer's id-set url-filter. Zero host-schema change.
  slots: { header: { react: { __component: TAGS_FILTER_EXTENSION_NAME } } },
  rowActions: [
    {
      kind: "navigate",
      id: "edit",
      label: "notes-demo:actions.edit",
      screen: "note-edit",
      entityId: "id",
    },
    {
      kind: "writeHandler",
      id: "delete",
      label: "notes-demo:actions.delete",
      handler: "notes-demo:write:note:delete",
      payload: { pick: ["id"] },
      confirm: "notes-demo:confirms.note-delete",
      style: "danger",
    },
  ],
  access: ADMIN_ACCESS,
};

const noteEditScreen: EntityEditScreenDefinition = {
  id: "note-edit",
  type: "entityEdit",
  entity: "note",
  layout: {
    sections: [
      { title: "notes-demo:section.note", fields: [{ field: "title", span: 1 }] },
      // The drop-in tag manager/picker, mounted as an extension section.
      {
        kind: "extension",
        title: "notes-demo:section.tags",
        component: { react: { __component: TAGS_SECTION_EXTENSION_NAME } },
      },
    ],
  },
  access: ADMIN_ACCESS,
};

export const notesFeature: FeatureDefinition = defineFeature("notes-demo", (r) => {
  r.describe("Dev-only host entity demonstrating tags on a real entityList + entityEdit screen.");
  r.requires("tags");
  r.entity("note", noteEntity);

  r.writeHandler(defineEntityCreateHandler("note", noteEntity, { access: ADMIN_ACCESS }));
  r.writeHandler(defineEntityUpdateHandler("note", noteEntity, { access: ADMIN_ACCESS }));
  r.writeHandler(defineEntityDeleteHandler("note", noteEntity, { access: ADMIN_ACCESS }));
  r.queryHandler(defineEntityListHandler("note", noteEntity, { access: ADMIN_ACCESS }));
  r.queryHandler(defineEntityDetailHandler("note", noteEntity, { access: ADMIN_ACCESS }));

  r.screen(noteListScreen);
  r.screen(noteEditScreen);
  return {};
});
