import type { AccessRule, WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { folderAssignmentAggregateId } from "../aggregate-id";
import { DEFAULT_FOLDER_ACCESS } from "../constants";
import { folderAssignmentExecutor, folderExecutor } from "../executor";
import { type SetFolderPayload, setFolderPayloadSchema } from "../schemas";

// set-folder — puts a host entity into a folder. Single-membership: the
// assignment id is deterministic over (tenant, entity) WITHOUT folderId, so an
// entity has exactly one assignment and setting a different folder MOVES it.
//
// Lifecycle (set → clear → set):
//   - already in the requested folder → success (requested end state).
//   - in a different folder           → update folderId (move).
//   - cleared (soft-deleted)          → restore() then update folderId to the
//     requested one. create() would append at version 0 onto the
//     created+deleted stream and version_conflict.
//   - never assigned                  → create().
// The internal move/restore-update uses skipOptimisticLock: this handler is the
// authority for the assignment's folderId, there is no client read-modify-write
// race to guard, and clients never send a version for set-folder.
//
// Referential integrity: there is no FK (event-sourced, no JOIN), so we verify
// the target folder exists before writing — a malformed call with an unknown
// folderId would otherwise point an entity at a phantom folder.
export function createSetFolderHandler(access: AccessRule = DEFAULT_FOLDER_ACCESS): WriteHandlerDef {
  return {
    name: "set-folder",
    schema: setFolderPayloadSchema,
    access,
    handler: async (event, ctx) => {
      const payload = event.payload as SetFolderPayload; // @cast-boundary engine-payload
      const id = folderAssignmentAggregateId(
        event.user.tenantId,
        payload.entityType,
        payload.entityId,
      );

      const folder = await folderExecutor.detail({ id: payload.folderId }, event.user, ctx.db);
      if (!folder) return writeFailure(new NotFoundError("folder", payload.folderId));

      const existing = await folderAssignmentExecutor.detail({ id }, event.user, ctx.db);
      if (existing) {
        if (existing["folderId"] === payload.folderId) {
          return { isSuccess: true as const, data: { id } };
        }
        return folderAssignmentExecutor.update(
          { id, changes: { folderId: payload.folderId } },
          event.user,
          ctx.db,
          { skipOptimisticLock: true },
        );
      }

      const restored = await folderAssignmentExecutor.restore({ id }, event.user, ctx.db);
      if (restored.isSuccess) {
        return folderAssignmentExecutor.update(
          { id, changes: { folderId: payload.folderId } },
          event.user,
          ctx.db,
          { skipOptimisticLock: true },
        );
      }
      if (restored.error.code !== "not_found") return restored;

      return folderAssignmentExecutor.create(
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

export const setFolderHandler: WriteHandlerDef = createSetFolderHandler();
