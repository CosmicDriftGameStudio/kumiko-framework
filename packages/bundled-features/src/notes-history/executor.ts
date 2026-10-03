import { createEntityExecutor, type EntityDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createNoteEntryEntity, noteEntryEntity, noteMentionEntity } from "./entity.js";

export const { executor: noteEntryExecutor, table: noteEntryTable } = createEntityExecutor(
  "note-entry",
  noteEntryEntity,
);

// Carries only `ownership.write`: the executor enforces entity.access.write on
// create, while read ownership is applied by the list handler.
export function createNoteEntryExecutor(
  ownership: EntityDefinition["access"] | undefined,
): typeof noteEntryExecutor {
  if (ownership?.write === undefined) return noteEntryExecutor;
  return createEntityExecutor("note-entry", createNoteEntryEntity({ write: ownership.write }))
    .executor;
}

export const { executor: noteMentionExecutor, table: noteMentionTable } = createEntityExecutor(
  "note-mention",
  noteMentionEntity,
);
