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
  defineFeature,
  type EntityEditScreenDefinition,
  type EntityListScreenDefinition,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";

const ADMIN_ACCESS = { roles: ["TenantAdmin", "SystemAdmin"] } as const;

export const noteEntity = createEntity({
  description:
    "A demo note holding just a title plus per-tenant custom-field values, used as the host object that the tags, folders and custom-fields extensions attach to.",
  table: "read_demo_notes",
  fields: {
    title: createTextField({ required: true, maxLength: 200, sortable: true }),
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
  defaultSort: { field: "title", dir: "asc" },
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
        contributesToFormSubmit: true,
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

  r.crud("note", noteEntity, {
    write: { access: ADMIN_ACCESS },
    read: { access: ADMIN_ACCESS },
    descriptions: {
      create:
        "Creates one demo note from its title plus the values entered in the custom-fields form section; used when the note edit screen saves a note that has not been stored yet.",
      update:
        "Applies a changed title or changed custom-field values to one existing note, addressed by id plus the version the client last read; used when the note edit screen saves.",
      delete:
        "Removes one note row for good, addressed by id; used by the confirmed danger row action on the note list, and there is no restore because the entity is not soft-deleted.",
      list: "Returns one page of notes, searchable and sorted by title; used by the note list screen that renders each row's tags column and the tag filter above it.",
      detail:
        "Returns one note by id; used when the note edit screen loads the row that hosts the custom-fields, folder and tags extension sections.",
    },
  });

  r.translations({
    keys: {
      "screen:note-list.title": { en: "Notes", de: "Notizen" },
      "screen:note-edit.title": { en: "Note", de: "Notiz" },
      "notes-demo:entity:note:field:title": { en: "Title", de: "Titel" },
      "notes-demo:section.note": { en: "Note", de: "Notiz" },
      "notes-demo:section.customFields": { en: "Custom fields", de: "Zusatzfelder" },
      "notes-demo:section.folder": { en: "Folder", de: "Ordner" },
      "notes-demo:section.tags": { en: "Tags", de: "Tags" },
      "notes-demo:actions.edit": { en: "Edit", de: "Bearbeiten" },
      "notes-demo:actions.delete": { en: "Delete", de: "Löschen" },
      "notes-demo:confirms.note-delete": {
        en: "Delete this note?",
        de: "Diese Notiz löschen?",
      },
    },
  });
  r.screen(noteListScreen);
  r.screen(noteEditScreen);
  return {};
});
