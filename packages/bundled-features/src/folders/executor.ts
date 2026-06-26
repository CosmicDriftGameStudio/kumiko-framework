import { createEntityExecutor } from "@cosmicdrift/kumiko-framework/engine";
import { folderAssignmentEntity, folderEntity } from "./entity";

// Shared executors for the folder + folder-assignment write-handlers.
// createEntityExecutor is side-effect-free; instantiating once keeps the
// table+executor pair in one place instead of rebuilding it per handler module.
export const { executor: folderExecutor } = createEntityExecutor("folder", folderEntity);
export const { executor: folderAssignmentExecutor } = createEntityExecutor(
  "folder-assignment",
  folderAssignmentEntity,
);
