import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { DEFAULT_FOLDER_ACCESS } from "../constants";
import { folderAssignmentExecutor, folderExecutor } from "../executor";

const deleteFolderPayloadSchema = z.object({ id: z.uuid() });

// delete-folder — the UI's folder-manager only blocks deleting a folder that
// still has CHILD folders; it never checks folder-assignments. A leaf folder
// holding entities could be deleted, leaving its folder-assignment rows
// pointing at a folderId that no longer exists (no cascade, no cleanup path —
// see 658/1). Block server-side instead: this is the same "referential
// integrity has no FK here" reasoning set-folder.write.ts already applies to
// folderId on assignment-creation.
export function createDeleteFolderHandler(
  access: AccessRule = DEFAULT_FOLDER_ACCESS,
): WriteHandlerDef {
  return {
    name: "folder:delete",
    schema: deleteFolderPayloadSchema,
    access,
    handler: async (event, ctx) => {
      const payload = event.payload as { id: string }; // @cast-boundary engine-payload
      const assigned = await folderAssignmentExecutor.list(
        { filter: { field: "folderId", op: "eq", value: payload.id }, limit: 1 },
        event.user,
        ctx.db,
      );
      if (assigned.rows.length > 0) {
        return writeFailure(
          new UnprocessableError("folder_has_assignments", { details: { folderId: payload.id } }),
        );
      }
      return folderExecutor.delete({ id: payload.id }, event.user, ctx.db);
    },
  };
}

export const deleteFolderHandler: WriteHandlerDef = createDeleteFolderHandler();
