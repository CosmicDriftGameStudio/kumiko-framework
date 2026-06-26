import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { folderAssignmentAggregateId } from "../aggregate-id";
import { DEFAULT_FOLDER_ACCESS } from "../constants";
import { folderAssignmentExecutor } from "../executor";
import { type ClearFolderPayload, clearFolderPayloadSchema } from "../schemas";

// clear-folder — removes a host entity from its folder (back to "unfiled").
// Idempotent: clearing an entity that isn't in any folder is already the
// requested end state, so we pre-check and return success without a delete.
export function createClearFolderHandler(
  access: AccessRule = DEFAULT_FOLDER_ACCESS,
): WriteHandlerDef {
  return {
    name: "clear-folder",
    schema: clearFolderPayloadSchema,
    access,
    handler: async (event, ctx) => {
      const payload = event.payload as ClearFolderPayload; // @cast-boundary engine-payload
      const id = folderAssignmentAggregateId(
        event.user.tenantId,
        payload.entityType,
        payload.entityId,
      );

      const existing = await folderAssignmentExecutor.detail({ id }, event.user, ctx.db);
      if (!existing) {
        return { isSuccess: true as const, data: { id } };
      }

      return folderAssignmentExecutor.delete({ id }, event.user, ctx.db);
    },
  };
}

export const clearFolderHandler: WriteHandlerDef = createClearFolderHandler();
