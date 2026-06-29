import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { DEFAULT_TAG_ACCESS } from "../constants";
import { tagAssignmentExecutor, tagExecutor } from "../executor";
import { type DeleteTagPayload, deleteTagPayloadSchema } from "../schemas";

const CASCADE_PAGE = 200;

// delete-tag — removes a tag from the catalog and detaches it everywhere. No FK
// (event-sourced, no JOIN), so the handler cascades: soft-delete every
// assignment carrying this tag, then hard-delete the catalog tag.
//
// Idempotent: deleting an already-gone tag returns success (mirrors remove-tag).
//
// The cascade re-reads page 1 (no cursor) until it comes back empty instead of
// paging with a cursor: assignment deletes are soft-deletes and the list query
// hides isDeleted rows, so a keyset cursor over the shrinking result set would
// silently skip rows. Re-reading the head always returns the remaining live
// rows and terminates when none are left.
export function createDeleteTagHandler(access: AccessRule = DEFAULT_TAG_ACCESS): WriteHandlerDef {
  return {
    name: "delete-tag",
    schema: deleteTagPayloadSchema,
    access,
    handler: async (event, ctx) => {
      const payload = event.payload as DeleteTagPayload; // @cast-boundary engine-payload

      const existing = await tagExecutor.detail({ id: payload.id }, event.user, ctx.db);
      if (!existing) {
        return { isSuccess: true as const, data: { id: payload.id } };
      }

      for (;;) {
        const page = await tagAssignmentExecutor.list(
          { filter: { field: "tagId", op: "eq", value: payload.id }, limit: CASCADE_PAGE },
          event.user,
          ctx.db,
        );
        if (page.rows.length === 0) break;
        for (const row of page.rows) {
          const removed = await tagAssignmentExecutor.delete(
            { id: String(row["id"]) },
            event.user,
            ctx.db,
          );
          if (!removed.isSuccess) return removed;
        }
      }

      return tagExecutor.delete({ id: payload.id }, event.user, ctx.db);
    },
  };
}

export const deleteTagHandler: WriteHandlerDef = createDeleteTagHandler();
