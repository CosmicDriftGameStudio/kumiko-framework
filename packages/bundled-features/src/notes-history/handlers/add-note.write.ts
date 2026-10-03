import { fetchOne, runInSavepointIfSupported } from "@cosmicdrift/kumiko-framework/bun-db";
import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { ValidationError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { decryptStoredPii, denyUnlessJoinRowParentVisible } from "../../shared/index.js";
import { tenantMembershipsTable } from "../../tenant/index.js";
import { userTable } from "../../user/index.js";
import { DEFAULT_NOTES_HISTORY_ACCESS } from "../constants.js";
import { noteEntryExecutor, noteMentionExecutor } from "../executor.js";
import { type AddNotePayload, addNotePayloadSchema } from "../schemas.js";

const READ_AUTHOR_DISPLAY_NAME_REASON =
  "reads the author's displayName from the global users table inside a savepoint so a missing user feature cannot poison the note transaction";

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
  entryExecutor: typeof noteEntryExecutor = noteEntryExecutor,
): WriteHandlerDef {
  return {
    name: "add-note",
    schema: addNotePayloadSchema,
    access,
    description:
      "Appends a note to one host entity's history, stamping the author from the authenticated caller rather than the payload; use it for every remark and correction alike, because entries can never be edited or removed afterwards.",
    escapeHatch: {
      grants: ["unsafeRaw"],
      reason: READ_AUTHOR_DISPLAY_NAME_REASON,
    },
    handler: async (event, ctx) => {
      const payload = event.payload as AddNotePayload; // @cast-boundary engine-payload

      const denied = await denyUnlessJoinRowParentVisible(
        ctx.registry,
        "note-entry",
        payload,
        event.user,
        ctx.db,
      );
      if (denied) return denied;

      // A mention of a non-member would leave a note body about that person out of reach of
      // their forget run, which only visits the tenants they are a member of.
      const mentionedUserIds = [...new Set(payload.mentions ?? [])];
      if (mentionedUserIds.length > 0) {
        const memberRows = await ctx.db.selectMany<{ userId: string }>(tenantMembershipsTable, {
          userId: { in: mentionedUserIds },
        });
        const memberIds = new Set(memberRows.map((row) => row.userId));
        if (mentionedUserIds.some((userId) => !memberIds.has(userId))) {
          return writeFailure(
            new ValidationError({
              fields: [{ path: "mentions", code: "custom", i18nKey: "errors.validation.custom" }],
            }),
          );
        }
      }

      let authorName: string | null = null;
      try {
        // read_users is tenant-agnostic → ctx.db.unsafeRaw, not the tenant-scoped ctx.db.
        // Bun.SQL poisons the whole tx after any error inside it, even one that's
        // caught — so the lookup runs in a savepoint where available, otherwise directly
        // (pool statements are their own units).
        authorName = await runInSavepointIfSupported(ctx.db.unsafeRaw(), async (sp) => {
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
      const created = await entryExecutor.create(
        { ...notePayload, authorId: event.user.id, authorName },
        event.user,
        ctx.db,
      );
      if (!created.isSuccess) return created;

      // Same tx as the note create above (ctx.db) — a mention-row failure
      // rolls the note back with it, same as the framework's own nested-write
      // parent+child pattern (dispatch-write.ts).
      for (const subjectId of mentionedUserIds) {
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
