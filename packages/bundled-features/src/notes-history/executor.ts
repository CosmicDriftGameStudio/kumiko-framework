import { createEntityExecutor } from "@cosmicdrift/kumiko-framework/engine";
import { noteEntryEntity, noteMentionEntity } from "./entity";

export const { executor: noteEntryExecutor, table: noteEntryTable } = createEntityExecutor(
  "note-entry",
  noteEntryEntity,
);

export const { executor: noteMentionExecutor, table: noteMentionTable } = createEntityExecutor(
  "note-mention",
  noteMentionEntity,
);
