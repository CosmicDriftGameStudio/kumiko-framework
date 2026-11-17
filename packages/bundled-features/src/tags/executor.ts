import { createEntityExecutor, type EntityDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createTagAssignmentEntity, tagEntity } from "./entity.ts";

// createEntityExecutor is side-effect-free; the table+executor pair for the tag catalog lives here.
export const { executor: tagExecutor } = createEntityExecutor("tag", tagEntity);

// Carries only `ownership.write`: the executor enforces entity.access.write on
// create/restore/delete, while a read rule would hide rows from the handlers'
// own idempotency reads and the delete-tag cascade.
export function createTagAssignmentExecutor(
  ownership: EntityDefinition["access"] | undefined,
  parents: readonly string[],
) {
  return createEntityExecutor(
    "tag-assignment",
    createTagAssignmentEntity(
      ownership?.write === undefined ? undefined : { write: ownership.write },
      parents,
    ),
  ).executor;
}

export type TagAssignmentExecutor = ReturnType<typeof createTagAssignmentExecutor>;
