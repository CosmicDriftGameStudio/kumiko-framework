import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { hostRowIsGone } from "../../shared/index.js";
import { DEFAULT_FOLDER_ACCESS } from "../constants.js";
import { folderAssignmentExecutor, folderExecutor } from "../executor.js";

const deleteFolderPayloadSchema = z.object({ id: z.uuid() });

// delete-folder — the UI's folder-manager only blocks deleting a folder that
// still has CHILD folders; it never checks folder-assignments. A leaf folder
// holding entities could be deleted, leaving its folder-assignment rows
// pointing at a folderId that no longer exists (no cascade, no cleanup path —
// see 658/1). Block server-side instead: this is the same "referential
// integrity has no FK here" reasoning set-folder.write.ts already applies to
// folderId on assignment-creation.
//
// Assignments whose host is gone (hard-deleted, soft-deleted or unregistered)
// are cleaned up here instead of blocking forever: clear-folder can't reach
// them (it requires a visible host). A host-delete hook would break restore,
// so the cleanup runs lazily at folder:delete.
const ASSIGNMENT_PAGE_SIZE = 200;
export function createDeleteFolderHandler(
  access: AccessRule = DEFAULT_FOLDER_ACCESS,
): WriteHandlerDef {
  return {
    name: "folder:delete",
    schema: deleteFolderPayloadSchema,
    access,
    description:
      "Deletes a folder from the tenant catalog and refuses while any live entity is still filed in it (assignments of deleted hosts are cleaned up); use it once that folder's contents have been unfiled or moved elsewhere.",
    agent: { risk: "high" },
    handler: async (event, ctx) => {
      const payload = event.payload as { id: string }; // @cast-boundary engine-payload
      const orphanAssignmentIds: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await folderAssignmentExecutor.list(
          {
            filter: { field: "folderId", op: "eq", value: payload.id },
            limit: ASSIGNMENT_PAGE_SIZE,
            cursor,
          },
          event.user,
          ctx.db,
        );
        for (const row of page.rows) {
          const gone = await hostRowIsGone(
            ctx.registry,
            String(row["entityType"]),
            String(row["entityId"]),
            ctx.db,
          );
          if (!gone) {
            return writeFailure(
              new UnprocessableError("folder_has_assignments", {
                details: { folderId: payload.id },
              }),
            );
          }
          orphanAssignmentIds.push(String(row["id"]));
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);

      for (const id of orphanAssignmentIds) {
        const removed = await folderAssignmentExecutor.delete({ id }, event.user, ctx.db);
        if (!removed.isSuccess) return removed;
      }
      return folderExecutor.delete({ id: payload.id }, event.user, ctx.db);
    },
  };
}

export const deleteFolderHandler: WriteHandlerDef = createDeleteFolderHandler();
