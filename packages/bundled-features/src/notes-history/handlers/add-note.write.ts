import { fetchOne, runInSavepointIfSupported } from "@cosmicdrift/kumiko-framework/bun-db";
import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { decryptStoredPii } from "../../shared";
import { userTable } from "../../user";
import { DEFAULT_NOTES_HISTORY_ACCESS } from "../constants";
import { noteEntryExecutor } from "../executor";
import { type AddNotePayload, addNotePayloadSchema } from "../schemas";

// add-note — appends a note-entry to (entityType, entityId). authorId is
// NEVER read from the payload: it is always the authenticated caller
// (event.user.id), so a note can't be authored as someone else. No update or
// delete counterpart is registered — see entity.ts for why append-only is
// deliberate.
export function createAddNoteHandler(
  access: AccessRule = DEFAULT_NOTES_HISTORY_ACCESS,
): WriteHandlerDef {
  return {
    name: "add-note",
    schema: addNotePayloadSchema,
    access,
    handler: async (event, ctx) => {
      const payload = event.payload as AddNotePayload; // @cast-boundary engine-payload

      let authorName: string | null = null;
      try {
        // read_users is tenant-agnostic → ctx.db.raw, not the tenant-scoped ctx.db.
        // Bun.SQL poisons the whole tx after any error inside it, even one that's
        // caught — a bare try/catch here would take the note write down with it.
        authorName = await runInSavepointIfSupported(ctx.db.raw, async (sp) => {
          const userRow = await fetchOne<{ displayName: string | null }>(sp, userTable, {
            id: event.user.id,
          });
          if (!userRow?.displayName) return null;
          return decryptStoredPii(userRow.displayName, "displayName", "notes-history:add-note");
        });
      } catch {
        authorName = null;
      }

      return noteEntryExecutor.create(
        { ...payload, authorId: event.user.id, authorName },
        event.user,
        ctx.db,
      );
    },
  };
}

export const addNoteHandler: WriteHandlerDef = createAddNoteHandler();
