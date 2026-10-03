import { createEntityExecutor, type EntityDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createTagAssignmentEntity, tagAssignmentEntity, tagEntity } from "./entity.js";

// Shared executors for the tag + tag-assignment write-handlers.
// createEntityExecutor is side-effect-free; instantiating once keeps the
// table+executor pair in one place instead of rebuilding it per handler module.
export const { executor: tagExecutor } = createEntityExecutor("tag", tagEntity);
export const { executor: tagAssignmentExecutor } = createEntityExecutor(
  "tag-assignment",
  tagAssignmentEntity,
);

// Carries only `ownership.write`: the executor enforces entity.access.write on
// create/restore/delete, while a read rule would hide rows from the handlers'
// own idempotency reads and the delete-tag cascade.
export function createTagAssignmentExecutor(
  ownership: EntityDefinition["access"] | undefined,
): typeof tagAssignmentExecutor {
  if (ownership?.write === undefined) return tagAssignmentExecutor;
  return createEntityExecutor(
    "tag-assignment",
    createTagAssignmentEntity({ write: ownership.write }),
  ).executor;
}
