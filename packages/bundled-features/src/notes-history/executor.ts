import { createEntityExecutor } from "@cosmicdrift/kumiko-framework/engine";
import { noteEntryEntity } from "./entity";

export const { executor: noteEntryExecutor, table: noteEntryTable } = createEntityExecutor(
  "note-entry",
  noteEntryEntity,
);
