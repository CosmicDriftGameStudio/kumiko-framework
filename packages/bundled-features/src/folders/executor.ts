import { createEntityExecutor, type EntityDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createFolderAssignmentEntity, folderEntity } from "./entity.ts";

// createEntityExecutor is side-effect-free; the table+executor pair for the folder catalog lives here.
export const { executor: folderExecutor } = createEntityExecutor(folderEntity);

// Carries the mount's parentRef so executor reads apply the same host gate as the registered entity.
// Carries only `ownership.write`: the executor enforces entity.access.write on create/restore/delete,
// while a read rule would hide rows from the handlers' own idempotency reads.
export function createFolderAssignmentExecutor(
  ownership: EntityDefinition["access"] | undefined,
  parents: readonly string[],
) {
  return createEntityExecutor(
    createFolderAssignmentEntity(
      ownership?.write === undefined ? undefined : { write: ownership.write },
      parents,
    ),
  ).executor;
}

export type FolderAssignmentExecutor = ReturnType<typeof createFolderAssignmentExecutor>;
