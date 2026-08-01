// kumiko-feature-version: 1
// Notes History Basic Sample
//
// Shows the whole point of the `notes-history` bundle: attaching a note
// history to an entity needs ZERO changes to that entity. The `task` entity
// below has no notes column, no note-specific wiring, no awareness of notes
// at all — yet tasks can carry a chronological, authored note history,
// because the notes-history feature owns its own table (read_note_entries)
// and keys entries by (entityType, entityId).
//
// Flow (see the integration test):
//   1. App-author defines a plain `task` entity — nothing note-specific.
//   2. A user appends a note via `notes-history:write:add-note` with
//      { entityType: "task", entityId: <taskId>, body }.
//   3. "What notes does this task have?" is a read-layer composition: list
//      `note-entry` filtered by entityId — no JOIN, no column on `task`.
//   4. The author is never client-supplied — the write-handler always
//      attributes the note to the authenticated caller.

import { buildEntityTable, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

// --- Entity ---
//
// A plain entity. Note there is NOTHING here that mentions notes — that is
// the feature's promise: any entity can carry a note history as-is.

export const taskEntity = createEntity({
  table: "read_sample_notes_history_tasks",
  fields: {
    title: createTextField({ required: true, maxLength: 200 }),
  },
});

const taskTable = buildEntityTable("task", taskEntity);

const taskExecutor = createEventStoreExecutor(taskTable, taskEntity, { entityName: "task" });

// --- Feature ---

export const taskFeature = defineFeature("task-management", (r) => {
  // notes-history is non-optional for this recipe: the demo notes tasks.
  // The task feature itself stays completely notes-agnostic — it only
  // declares the dependency so the bundle is mounted.
  r.requires("notes-history");

  r.entity("task", taskEntity);

  r.writeHandler({
    name: "task:create",
    schema: z.object({ id: z.string(), title: z.string() }),
    access: { roles: ["TenantAdmin"] },
    handler: async (event, ctx) =>
      taskExecutor.create({ id: event.payload.id, title: event.payload.title }, event.user, ctx.db),
  });

  r.queryHandler({
    name: "task:list",
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async (_query, ctx) => {
      const rows = await ctx.db.selectMany(taskTable);
      return { rows };
    },
  });
});
