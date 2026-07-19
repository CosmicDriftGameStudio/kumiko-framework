// kumiko-feature-version: 1
// Tags Basic Sample
//
// Shows the whole point of the `tags` bundle: tagging an entity needs ZERO
// changes to that entity. The `note` entity below has no tag column, no
// `wireTagsFor`, no awareness of tags at all — yet notes can be tagged and
// grouped, because the tags feature owns its own tables (read_tags +
// read_tag_assignments) and keys assignments by (entityType, entityId).
//
// Flow (see the integration test):
//   1. App-author defines a plain `note` entity — nothing tag-specific.
//   2. A tenant creates a tag via `tags:write:create-tag`.
//   3. The tag is attached to a note via `tags:write:assign-tag`
//      with { tagId, entityType: "note", entityId: <noteId> }.
//   4. "Which tags does this note have?" / "Which notes carry this tag?"
//      are read-layer compositions: list `tag-assignment` filtered by
//      entityId or tagId — no JOIN, no column on `note`.

import { buildEntityTable, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

// --- Entity ---
//
// A plain entity. Note there is NOTHING here that mentions tags — that is the
// feature's promise: any entity is taggable as-is.

export const noteEntity = createEntity({
  table: "read_sample_tags_notes",
  fields: {
    title: createTextField({ required: true, maxLength: 200 }),
  },
});

const noteTable = buildEntityTable("note", noteEntity);

const noteExecutor = createEventStoreExecutor(noteTable, noteEntity, { entityName: "note" });

// --- Feature ---

export const noteFeature = defineFeature("note-management", (r) => {
  // tags is non-optional for this recipe: the demo tags notes. The note
  // feature itself stays completely tag-agnostic — it only declares the
  // dependency so the bundle is mounted.
  r.requires("tags");

  r.entity("note", noteEntity);

  r.writeHandler({
    name: "note:create",
    schema: z.object({ id: z.string(), title: z.string() }),
    access: { roles: ["TenantAdmin"] },
    handler: async (event, ctx) =>
      noteExecutor.create({ id: event.payload.id, title: event.payload.title }, event.user, ctx.db),
  });

  r.queryHandler({
    name: "note:list",
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async (_query, ctx) => {
      const rows = await ctx.db.selectMany(noteTable);
      return { rows };
    },
  });
});
