import { createEntityExecutor, type EntityDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createNoteEntryEntity, noteEntryEntity, noteMentionEntity } from "./entity.ts";

// ungated: system paths and tests only; handlers use createNoteEntryExecutor
export const { executor: noteEntryExecutor, table: noteEntryTable } = createEntityExecutor(
  noteEntryEntity,
);

// Carries only `ownership.write`: the executor enforces entity.access.write on
// create, while read ownership is applied by the list handler.
export function createNoteEntryExecutor(
  ownership: EntityDefinition["access"] | undefined,
  parents: readonly string[],
): typeof noteEntryExecutor {
  return createEntityExecutor(
    createNoteEntryEntity(
      ownership?.write === undefined ? undefined : { write: ownership.write },
      parents,
    ),
  ).executor;
}

export const { executor: noteMentionExecutor, table: noteMentionTable } = createEntityExecutor(
  noteMentionEntity,
);
