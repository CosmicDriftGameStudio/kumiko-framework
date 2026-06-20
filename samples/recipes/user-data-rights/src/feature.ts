// User-Data-Rights — Recipe
//
// Wie eine App-Domain DSGVO-Pipeline integriert: pro Entity einen
// (export, delete)-Hook ueber EXT_USER_DATA. Forget-Cron, Export-ZIP-Bau
// und Magic-Link-Versand kommen vollstaendig aus user-data-rights —
// App-Author schreibt nur die zwei Hooks pro Entity.
//
// Demo-Domain: minimaler Note-Service. Note hat (id, tenantId, authorId,
// title, body). Pinst:
//   1. Hook export liefert Note-Rows als JSON-Snippet ins Export-Bundle.
//   2. Hook delete entfernt Note-Rows beim Forget-Cleanup-Cron.
//
// Was nicht im Recipe ist (siehe samples/apps/user-data-rights-demo
// fuer eine vollstaendige App):
//   - Strategy-aware delete (anonymize vs hardDelete)
//   - HTTP-Endpoints fuer create/list
//   - Compliance-Profile-Wiring + Cron-Scheduling

import { deleteMany, selectMany, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable, buildEntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  EXT_USER_DATA,
  type UserDataDeleteHook,
  type UserDataExportHook,
} from "@cosmicdrift/kumiko-framework/engine";

export const noteEntity = createEntity({
  table: "read_notes",
  idType: "uuid",
  fields: {
    authorId: createTextField({}),
    title: createTextField({ required: true, maxLength: 200 }),
    body: createTextField({ maxLength: 4000 }),
  },
});

export const notesTable = buildEntityTable("note", noteEntity);

export const notesFeature = defineFeature("notes", (r) => {
  r.requires("user-data-rights");
  // read_notes is a direct-write store: the forget hook below `updateMany`/
  // `deleteMany`s rows WITHOUT emitting lifecycle events. r.entity would make
  // it a rebuildable implicit projection whose replay finds zero note events
  // and wipes the table (or un-forgets anonymized rows) on the next rebuild
  // (#498). r.unmanagedTable keeps the DDL, opts out of implicit rebuild.
  r.unmanagedTable(buildEntityTableMeta("note", noteEntity), {
    reason: "read_side.notes_direct_write",
  });

  const exportNotes: UserDataExportHook = async (ctx) => {
    const rows = await selectMany(ctx.db, notesTable, {
      tenantId: ctx.tenantId,
      authorId: ctx.userId,
    });
    if (rows.length === 0) return null;
    return {
      entity: "note",
      rows: rows.map((row) => ({
        id: String(row.id),
        title: row.title ?? "",
        body: row.body ?? "",
      })),
    };
  };

  const deleteNotes: UserDataDeleteHook = async (ctx, strategy) => {
    const where = { tenantId: ctx.tenantId, authorId: ctx.userId };
    if (strategy === "anonymize") {
      await updateMany(ctx.db, notesTable, { authorId: null }, where);
    } else {
      await deleteMany(ctx.db, notesTable, where);
    }
  };

  r.useExtension(EXT_USER_DATA, "note", {
    export: exportNotes,
    delete: deleteNotes,
  });
});
