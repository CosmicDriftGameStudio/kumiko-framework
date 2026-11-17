import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { denyUnlessJoinRowParentVisible } from "../../shared/index.ts";
import { folderAssignmentAggregateId } from "../aggregate-id.ts";
import { type FolderAssignmentExecutor, folderExecutor } from "../executor.ts";
import { type SetFolderPayload, setFolderPayloadSchema } from "../schemas.ts";
import { FOLDER_LOCK_NAMESPACE } from "../web/constants.ts";

// set-folder — files a host entity into one folder; the assignment id ignores folderId, so another folder MOVES it.
// Lifecycle: already in folder → success; other folder → update folderId (move); cleared (soft-deleted)
// → restore() then update, since create() would version_conflict on the created+deleted stream;
// never assigned → create(). skipOptimisticLock: this handler owns folderId, clients send no version.
// Referential integrity: no FK, so the target folder is verified first (no phantom folders).
// Host reference: entityType/entityId are untrusted, so the host must be readable by the caller
// (shared/parent-visibility.ts).
export function createSetFolderHandler(
  access: AccessRule,
  assignmentExecutor: FolderAssignmentExecutor,
): WriteHandlerDef {
  return {
    name: "set-folder",
    schema: setFolderPayloadSchema,
    access,
    description:
      "Files a host entity into one existing folder and moves it out of whatever folder it was in, since an entity belongs to at most one folder; use it for both the first filing and every later move.",
    handler: async (event, ctx) => {
      const payload = event.payload as SetFolderPayload; // @cast-boundary engine-payload
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

      // Same lock as folder:delete: the delete must not slip in between this existence check and
      // the assignment write, or the assignment points at a deleted folder.
      await ctx.db.advisoryXactLock(FOLDER_LOCK_NAMESPACE, payload.folderId);
      const folder = await folderExecutor.detail({ id: payload.folderId }, event.user, ctx.db);
      if (!folder) return writeFailure(new NotFoundError("folder", payload.folderId));

      const existing = await assignmentExecutor.detail({ id }, event.user, ctx.db);
      if (existing) {
        if (existing["folderId"] === payload.folderId) {
          return { isSuccess: true as const, data: { id } };
        }
        return assignmentExecutor.update(
          { id, changes: { folderId: payload.folderId } },
          event.user,
          ctx.db,
          { skipOptimisticLock: true },
        );
      }

      const restored = await assignmentExecutor.restore({ id }, event.user, ctx.db);
      if (restored.isSuccess) {
        return assignmentExecutor.update(
          { id, changes: { folderId: payload.folderId } },
          event.user,
          ctx.db,
          { skipOptimisticLock: true },
        );
      }
      if (restored.error.code !== "not_found") return restored;

      return assignmentExecutor.create(
        {
          id,
          folderId: payload.folderId,
          entityType: payload.entityType,
          entityId: payload.entityId,
        },
        event.user,
        ctx.db,
      );
    },
  };
}
