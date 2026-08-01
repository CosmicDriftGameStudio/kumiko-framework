import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
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
      return noteEntryExecutor.create({ ...payload, authorId: event.user.id }, event.user, ctx.db);
    },
  };
}

export const addNoteHandler: WriteHandlerDef = createAddNoteHandler();
