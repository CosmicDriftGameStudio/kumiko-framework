import {
  type AccessRule,
  type HandlerContext,
  parentVisibilityFor,
  registeredEntityExecutor,
  type SessionUser,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { liveHostRowIds } from "../../shared/index.ts";
import { type TagAssignmentExecutor, tagExecutor } from "../executor.ts";
import { type DeleteTagPayload, deleteTagPayloadSchema } from "../schemas.ts";
import { TAG_LOCK_NAMESPACE } from "../web/constants.ts";

const CASCADE_PAGE = 200;

// tag:delete — no FK, so the handler cascades; it refuses while an assignment the caller cannot
// read still points at a live record, so a catalog delete never detaches a tag from records of
// other teams. Assignments of gone hosts go with the tag; nothing is deleted before the scan
// finished, so the keyset cursor is safe. Idempotent: deleting an already-gone tag succeeds.
async function pageHidesLiveAssignment(
  rows: readonly Record<string, unknown>[],
  user: SessionUser,
  ctx: HandlerContext,
): Promise<boolean> {
  if (rows.length === 0) return false;
  const readable = registeredEntityExecutor(ctx.registry, "tag-assignment");
  const readableIds = new Set<string>();
  if (readable !== undefined) {
    const page = await readable.list(
      {
        filters: [{ field: "id", op: "in", value: rows.map((row) => String(row["id"])) }],
        limit: rows.length,
      },
      user,
      ctx.db,
      { parentVisibility: parentVisibilityFor(ctx, user) },
    );
    for (const row of page.rows) readableIds.add(String(row["id"]));
  }
  const hiddenIdsByType = new Map<string, string[]>();
  for (const row of rows) {
    if (readableIds.has(String(row["id"]))) continue;
    const entityType = String(row["entityType"]);
    const entityIds = hiddenIdsByType.get(entityType) ?? [];
    entityIds.push(String(row["entityId"]));
    hiddenIdsByType.set(entityType, entityIds);
  }
  for (const [entityType, entityIds] of hiddenIdsByType) {
    const liveIds = await liveHostRowIds(ctx.registry, entityType, entityIds, ctx.db);
    if (liveIds.size > 0) return true;
  }
  return false;
}

export function createDeleteTagHandler(
  access: AccessRule,
  assignmentExecutor: TagAssignmentExecutor,
  name = "tag:delete",
): WriteHandlerDef {
  return {
    name,
    schema: deleteTagPayloadSchema,
    access,
    description:
      "Deletes a catalog tag and detaches it from every record carrying it; refuses while a record the caller cannot see still carries the tag.",
    agent: { risk: "high" },
    handler: async (event, ctx) => {
      const payload = event.payload as DeleteTagPayload; // @cast-boundary engine-payload

      // Serialises with assign-tag (see there): the cascade must see every
      // assignment that a concurrent assign-tag committed before the tag goes.
      await ctx.db.advisoryXactLock(TAG_LOCK_NAMESPACE, payload.id);
      const existing = await tagExecutor.detail({ id: payload.id }, event.user, ctx.db);
      if (!existing) {
        return { isSuccess: true as const, data: { id: payload.id } };
      }

      const assignmentIds: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await assignmentExecutor.list(
          {
            filter: { field: "tagId", op: "eq", value: payload.id },
            limit: CASCADE_PAGE,
            cursor,
          },
          event.user,
          ctx.db,
        );
        if (await pageHidesLiveAssignment(page.rows, event.user, ctx)) {
          return writeFailure(
            new UnprocessableError("tag_in_use_on_hidden_records", {
              details: { tagId: payload.id },
            }),
          );
        }
        for (const row of page.rows) assignmentIds.push(String(row["id"]));
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);

      for (const id of assignmentIds) {
        const removed = await assignmentExecutor.delete({ id }, event.user, ctx.db);
        if (!removed.isSuccess) return removed;
      }

      return tagExecutor.delete({ id: payload.id }, event.user, ctx.db);
    },
  };
}
