// @runtime dev
//
// Dev-/screenshot-only host entity for the tags, custom-fields, and folders
// features. A plain `note` knows NOTHING about those bundles (no extra columns
// for tags/folders) — yet its edit screen hosts the drop-in extension sections,
// proving the "extend any object" promise on real, bootable screens.
//
// Deliberately NOT in src/run-config.ts APP_FEATURES: that set is bundled-only
// (schema/generate.ts FEATURE_IMPORT_REGISTRY + check-coverage gate it). Like
// appScreensFeature, this app-owned feature is mounted only in the dev server
// (src/app/server.ts), where runDevApp dev-pushes its table into the ephemeral
// DB. Nothing here ships to prod / the schema pipeline.

import {
  customFieldsField,
  wireCustomFieldsFor,
} from "@cosmicdrift/kumiko-bundled-features/custom-fields";
import { CUSTOM_FIELDS_FORM_EXTENSION_NAME } from "@cosmicdrift/kumiko-bundled-features/custom-fields/web";
import { FOLDER_SECTION_EXTENSION_NAME } from "@cosmicdrift/kumiko-bundled-features/folders";
import {
  TAGS_COLUMN_RENDERER_NAME,
  TAGS_FILTER_EXTENSION_NAME,
  TAGS_SECTION_EXTENSION_NAME,
} from "@cosmicdrift/kumiko-bundled-features/tags";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
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

export const noteEntity = createEntity({
  table: "read_demo_notes",
  fields: {
    title: createTextField({ required: true, maxLength: 200 }),
    customFields: customFieldsField(),
  },
});

export const noteTable = buildEntityTable("note", noteEntity);

const noteListScreen: EntityListScreenDefinition = {
  id: "note-list",
  type: "entityList",
  entity: "note",
  columns: [
    "title",
    {
      field: "tags",
      label: "Tags",
      renderer: { react: { __component: TAGS_COLUMN_RENDERER_NAME } },
    },
  ],
  searchable: true,
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
      {
        kind: "extension",
        title: "notes-demo:section.customFields",
        component: { react: { __component: CUSTOM_FIELDS_FORM_EXTENSION_NAME } },
      },
      {
        kind: "extension",
        title: "notes-demo:section.folder",
        component: { react: { __component: FOLDER_SECTION_EXTENSION_NAME } },
      },
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
  r.describe(
    "Dev-only host entity demonstrating tags, custom-fields, and folders on a real entityEdit screen.",
  );
  r.requires("tags");
  r.requires("custom-fields");
  r.requires("folders");

  wireCustomFieldsFor(r, "note", noteTable);

  r.entity("note", {
    table: "read_demo_notes",
    fields: {
      title: { type: "text", required: true, maxLength: 200 },
      customFields: { type: "jsonb" },
    },
  });

  r.writeHandler(defineEntityCreateHandler("note", noteEntity, { access: ADMIN_ACCESS }));
  r.writeHandler(defineEntityUpdateHandler("note", noteEntity, { access: ADMIN_ACCESS }));
  r.writeHandler(defineEntityDeleteHandler("note", noteEntity, { access: ADMIN_ACCESS }));
  r.queryHandler(defineEntityListHandler("note", noteEntity, { access: ADMIN_ACCESS }));
  r.queryHandler(defineEntityDetailHandler("note", noteEntity, { access: ADMIN_ACCESS }));

  r.screen(noteListScreen);
  r.screen(noteEditScreen);
  return {};
});
