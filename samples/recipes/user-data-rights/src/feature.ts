// User-Data-Rights — recipe
//
// How an app domain integrates the GDPR pipeline: one
// (export, delete) hook per entity via EXT_USER_DATA. Forget cron, export ZIP build
// and magic link delivery come entirely from user-data-rights —
// the app author writes only the two hooks per entity.
//
// Demo domain: minimal note service. A note has (id, tenantId, authorId,
// title, body). Pins:
//   1. The export hook delivers note rows as a JSON snippet into the export bundle.
//   2. The delete hook removes note rows during the forget-cleanup cron.
//   3. An event-sourced entity needs no hand-written loop: forgetOwnRowsDeleteHook forgets
//      every mute the user set or received, trashed rows included.
//
// What is not in the recipe (see samples/apps/user-data-rights-demo
// for a complete app):
//   - Strategy-aware delete (anonymize vs hardDelete)
//   - HTTP endpoints for create/list
//   - Compliance profile wiring + cron scheduling

import { forgetOwnRowsDeleteHook } from "@cosmicdrift/kumiko-bundled-features/user-data-rights-defaults";
import {
  deleteMany,
  deriveEntityTableMeta,
  selectMany,
  updateMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createEntityExecutor,
  createTextField,
  defineFeature,
  EXT_USER_DATA,
  type UserDataDeleteHook,
  type UserDataExportHook,
} from "@cosmicdrift/kumiko-framework/engine";

export const noteEntity = createEntity({
  name: "note",
  table: "store_notes",
  idType: "uuid",
  fields: {
    authorId: createTextField({ personal: "ref" }),
    title: createTextField({
      personal: false,
      reason: "is_business_data",
      required: true,
      maxLength: 200,
    }),
    // Plaintext on purpose: store_notes is an unmanaged direct-write store, so the
    // PII executor never encrypts it. Art. 17 runs through the EXT_USER_DATA
    // hook below instead (deletes the author's rows, or unlinks them on anonymize).
    body: createTextField({
      personal: false,
      reason: "covered_by_user_data_hook",
      maxLength: 4000,
    }),
  },
});

// Plain EntityTableMeta, NOT a branded EntityTable: store_notes is a deliberate
// unmanaged direct-write store (r.storeTable below), so the forget hook may
// updateMany/deleteMany it directly — the meta carries no executor-only brand.
export type NoteRow = {
  readonly id: string;
  readonly authorId: string | null;
  readonly title: string;
  readonly body: string | null;
};

export const notesTable = deriveEntityTableMeta(noteEntity, { source: "unmanaged" });

export const muteEntity = createEntity({
  name: "mute",
  table: "read_udr_recipe_mutes",
  idType: "uuid",
  softDelete: true,
  fields: {
    userId: createTextField({ personal: "ref", required: true }),
    mutedUserId: createTextField({ personal: "ref", required: true }),
  },
});

export const { table: mutesTable, executor: muteExecutor } = createEntityExecutor(muteEntity);

// A mute names two users; when either is erased the row goes, so no mute points at a missing user.
export const forgetMutes = forgetOwnRowsDeleteHook({
  entityName: "mute",
  table: mutesTable,
  executor: muteExecutor,
  ownerFields: ["userId", "mutedUserId"],
});

export const notesFeature = defineFeature("notes", (r) => {
  r.requires({ features: ["user-data-rights"] });
  // store_notes is a direct-write store: the forget hook below `updateMany`/
  // `deleteMany`s rows WITHOUT emitting lifecycle events. r.entity would make
  // it a rebuildable implicit projection whose replay finds zero note events
  // and wipes the table (or un-forgets anonymized rows) on the next rebuild
  // (#498). r.storeTable keeps the DDL, opts out of implicit rebuild.
  r.storeTable(notesTable, {
    reason: "read_side.notes_direct_write",
  });

  const exportNotes: UserDataExportHook = async (ctx) => {
    const rows = await selectMany<NoteRow>(ctx.db, notesTable, {
      tenantId: ctx.tenantId,
      authorId: ctx.userId,
    });
    if (rows.length === 0) return null;
    return {
      entity: "note",
      rows: rows.map((row) => ({
        id: row.id,
        title: row.title,
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

  r.applyExtension({
    name: EXT_USER_DATA,
    entity: "note",
    export: exportNotes,
    delete: deleteNotes,
  });

  r.entity(muteEntity);
  r.applyExtension({ name: EXT_USER_DATA, entity: "mute", delete: forgetMutes });
});
