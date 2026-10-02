import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { denyUnlessJoinRowParentVisible } from "../../shared/index.js";
import { folderAssignmentAggregateId } from "../aggregate-id.js";
import { DEFAULT_FOLDER_ACCESS } from "../constants.js";
import { folderAssignmentExecutor } from "../executor.js";
import { type ClearFolderPayload, clearFolderPayloadSchema } from "../schemas.js";

// clear-folder — removes a host entity from its folder (back to "unfiled").
// Idempotent: clearing an entity that isn't in any folder is already the
// requested end state, so we pre-check and return success without a delete.
//
// Host reference: entityType/entityId are client input, so the caller must be
// able to see the host row before unfiling it — see
// shared/parent-visibility.ts.
export function createClearFolderHandler(
  access: AccessRule = DEFAULT_FOLDER_ACCESS,
): WriteHandlerDef {
  return {
    name: "clear-folder",
    schema: clearFolderPayloadSchema,
    access,
    description:
      "Unfiles a host entity so it sits in no folder at all, reporting success when it was already unfiled; use it to take an entity out of its folder without touching the folder itself.",
    handler: async (event, ctx) => {
      const payload = event.payload as ClearFolderPayload; // @cast-boundary engine-payload
      const denied = await denyUnlessJoinRowParentVisible(
        ctx.registry,
        "folder-assignment",
        payload,
        event.user,
        ctx.db,
      );
      if (denied) return denied;

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
