import { createEntityExecutor } from "@cosmicdrift/kumiko-framework/engine";
import { tagAssignmentEntity, tagEntity } from "./entity";

// Shared executors for the tag + tag-assignment write-handlers.
// createEntityExecutor is side-effect-free; instantiating once keeps the
// table+executor pair in one place instead of rebuilding it per handler module.
export const { executor: tagExecutor } = createEntityExecutor("tag", tagEntity);
export const { executor: tagAssignmentExecutor } = createEntityExecutor(
  "tag-assignment",
  tagAssignmentEntity,
);
