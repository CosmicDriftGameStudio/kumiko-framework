import { createEntityExecutor } from "@cosmicdrift/kumiko-framework/engine";
import { createFolderAssignmentEntity, folderEntity } from "./entity.ts";

// createEntityExecutor is side-effect-free; the table+executor pair for the folder catalog lives here.
export const { executor: folderExecutor } = createEntityExecutor("folder", folderEntity);

// Carries the mount's parentRef so executor reads apply the same host gate as the registered entity.
export function createFolderAssignmentExecutor(parents: readonly string[]) {
  return createEntityExecutor(
    "folder-assignment",
    createFolderAssignmentEntity(undefined, parents),
  ).executor;
}

export type FolderAssignmentExecutor = ReturnType<typeof createFolderAssignmentExecutor>;
