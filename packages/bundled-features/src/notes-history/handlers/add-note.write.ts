import { fetchOne, runInSavepointIfSupported } from "@cosmicdrift/kumiko-framework/bun-db";
import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { decryptStoredPii } from "../../shared";
import { userTable } from "../../user";
import { DEFAULT_NOTES_HISTORY_ACCESS } from "../constants";
import { noteEntryExecutor } from "../executor";
import { parentRowIsVisible } from "../parent-visibility";
import { type AddNotePayload, addNotePayloadSchema } from "../schemas";

// add-note — appends a note-entry to (entityType, entityId). authorId is
// NEVER read from the payload: it is always the authenticated caller
// (event.user.id), so a note can't be authored as someone else. No update or
// delete counterpart is registered — see entity.ts for why append-only is
// deliberate.
//
// When `parents` is set (see feature.ts), entityType/entityId are no longer
// trusted client input: both the allowlist membership and the row's
// visibility through the parent entity's own read path are checked first.
export function createAddNoteHandler(
  access: AccessRule = DEFAULT_NOTES_HISTORY_ACCESS,
  parents?: ReadonlySet<string>,
): WriteHandlerDef {
  return {
    name: "add-note",
    schema: addNotePayloadSchema,
    access,
    description:
      "Appends a note to one host entity's history, stamping the author from the authenticated caller rather than the payload; use it for every remark and correction alike, because entries can never be edited or removed afterwards.",
    handler: async (event, ctx) => {
      const payload = event.payload as AddNotePayload; // @cast-boundary engine-payload

      if (parents !== undefined) {
        // NotFoundError, not an access-denied error, so the response doesn't
        // double as an existence oracle — same policy as executor.detail,
        // which never distinguishes "no access" from "doesn't exist".
        if (!parents.has(payload.entityType)) {
          return writeFailure(new NotFoundError(payload.entityType, payload.entityId));
        }
        const visible = await parentRowIsVisible(
          ctx.registry,
          payload.entityType,
          payload.entityId,
          event.user,
          ctx.db,
        );
        if (!visible) {
          return writeFailure(new NotFoundError(payload.entityType, payload.entityId));
        }
      }

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
      } catch (e) {
        ctx.log?.warn("notes-history: authorName lookup failed", {
          error: e,
          userId: event.user.id,
        });
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
