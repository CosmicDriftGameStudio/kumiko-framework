import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { liveHostRowIds } from "../../shared/index.ts";
import { type FolderAssignmentExecutor, folderExecutor } from "../executor.ts";
import { FOLDER_LOCK_NAMESPACE } from "../web/constants.ts";

const deleteFolderPayloadSchema = z.object({ id: z.uuid() });

// No FK: refuse while child folders or live assignments exist. The advisory lock serialises with
// set-folder and the parent guard. Assignments of gone hosts are removed here: clear-folder needs
// a visible host, and a host-delete hook would break restore.
const ASSIGNMENT_PAGE_SIZE = 200;
export function createDeleteFolderHandler(
  access: AccessRule,
  assignmentExecutor: FolderAssignmentExecutor,
): WriteHandlerDef {
  return {
    name: "folder:delete",
    schema: deleteFolderPayloadSchema,
    access,
    description:
      "Deletes a folder from the tenant catalog and refuses while child folders or any live entity are still in it (assignments of deleted hosts are cleaned up); use it once that folder's contents have been unfiled or moved elsewhere.",
    agent: { risk: "high" },
    handler: async (event, ctx) => {
      const payload = event.payload as { id: string }; // @cast-boundary engine-payload
      await ctx.db.advisoryXactLock(FOLDER_LOCK_NAMESPACE, payload.id);
      const children = await folderExecutor.list(
        { filter: { field: "parentId", op: "eq", value: payload.id }, limit: 1 },
        event.user,
        ctx.db,
      );
      if (children.rows.length > 0) {
        return writeFailure(
          new UnprocessableError("folder_has_children", { details: { folderId: payload.id } }),
        );
      }
      const orphanAssignmentIds: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await assignmentExecutor.list(
          {
            filter: { field: "folderId", op: "eq", value: payload.id },
            limit: ASSIGNMENT_PAGE_SIZE,
            cursor,
          },
          event.user,
          ctx.db,
        );
        const entityIdsByType = new Map<string, string[]>();
        for (const row of page.rows) {
          const entityType = String(row["entityType"]);
          const entityIds = entityIdsByType.get(entityType) ?? [];
          entityIds.push(String(row["entityId"]));
          entityIdsByType.set(entityType, entityIds);
        }
        for (const [entityType, entityIds] of entityIdsByType) {
          const liveIds = await liveHostRowIds(ctx.registry, entityType, entityIds, ctx.db);
          if (liveIds.size > 0) {
            return writeFailure(
              new UnprocessableError("folder_has_assignments", {
                details: { folderId: payload.id },
              }),
            );
          }
        }
        for (const row of page.rows) orphanAssignmentIds.push(String(row["id"]));
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);

      for (const id of orphanAssignmentIds) {
        const removed = await assignmentExecutor.delete({ id }, event.user, ctx.db);
        if (!removed.isSuccess) return removed;
      }
      return folderExecutor.delete({ id: payload.id }, event.user, ctx.db);
    },
  };
}

