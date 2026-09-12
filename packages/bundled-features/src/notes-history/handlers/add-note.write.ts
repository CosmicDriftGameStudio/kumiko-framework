import { fetchOne, runInSavepointIfSupported } from "@cosmicdrift/kumiko-framework/bun-db";
import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { decryptStoredPii, joinRowParentIsVisible } from "../../shared";
import { userTable } from "../../user";
import { DEFAULT_NOTES_HISTORY_ACCESS } from "../constants";
import { noteEntryExecutor, noteMentionExecutor } from "../executor";
import { type AddNotePayload, addNotePayloadSchema } from "../schemas";

// add-note — appends a note-entry to (entityType, entityId). authorId is
// NEVER read from the payload: it is always the authenticated caller
// (event.user.id), so a note can't be authored as someone else. No update or
// delete counterpart is registered — see entity.ts for why append-only is
// deliberate.
//
// entityType/entityId are never trusted client input: entityType must name a
// registered entity, and the row must be visible to the caller through that
// entity's own read path (tenant scope plus its `access.read` ownership).
// Both the field names and the optional `parents` allowlist come from the
// entity's own `parentRef` declaration, which the read gate reads too —
// see shared/parent-visibility.ts.
export function createAddNoteHandler(
  access: AccessRule = DEFAULT_NOTES_HISTORY_ACCESS,
): WriteHandlerDef {
  return {
    name: "add-note",
    schema: addNotePayloadSchema,
    access,
    description:
      "Appends a note to one host entity's history, stamping the author from the authenticated caller rather than the payload; use it for every remark and correction alike, because entries can never be edited or removed afterwards.",
    handler: async (event, ctx) => {
      const payload = event.payload as AddNotePayload; // @cast-boundary engine-payload

      // NotFoundError, not an access-denied error, so the response doesn't
      // double as an existence oracle — same policy as executor.detail,
      // which never distinguishes "no access" from "doesn't exist".
      const visible = await joinRowParentIsVisible(
        ctx.registry,
        "note-entry",
        payload,
        event.user,
        ctx.db,
      );
      if (!visible) {
        return writeFailure(new NotFoundError(payload.entityType, payload.entityId));
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

      const { mentions, ...notePayload } = payload;
      const created = await noteEntryExecutor.create(
        { ...notePayload, authorId: event.user.id, authorName },
        event.user,
        ctx.db,
      );
      if (!created.isSuccess) return created;

      // Same tx as the note create above (ctx.db) — a mention-row failure
      // rolls the note back with it, same as the framework's own nested-write
      // parent+child pattern (dispatch-write.ts).
      for (const subjectId of new Set(mentions ?? [])) {
        const mentionResult = await noteMentionExecutor.create(
          { noteId: created.data.id, subjectId },
          event.user,
          ctx.db,
        );
        if (!mentionResult.isSuccess) return mentionResult;
      }

      return created;
    },
  };
}

export const addNoteHandler: WriteHandlerDef = createAddNoteHandler();
