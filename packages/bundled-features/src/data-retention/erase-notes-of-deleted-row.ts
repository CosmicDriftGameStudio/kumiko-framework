import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { NOTES_HISTORY_FEATURE_NAME } from "../notes-history/index.ts";
import { eraseNoteBodiesReachingSubject } from "../notes-history-user-data/index.ts";

// Note bodies are keyed per note, so a hardDeleted parent's own key never reaches them. The runner
// is the retention job's unfiltered one: notes of a global parent sit in whichever tenant wrote them.
export async function eraseNotesOfDeletedRow(args: {
  readonly registry: Registry;
  readonly tx: DbRunner;
  readonly entityName: string;
  readonly rowId: string;
  readonly erasedBy: string;
}): Promise<void> {
  // skip: without notes-history there are no notes hanging on the row
  if (!args.registry.features.has(NOTES_HISTORY_FEATURE_NAME)) return;
  await eraseNoteBodiesReachingSubject({
    db: args.tx,
    subject: { kind: "record", entity: args.entityName, id: args.rowId },
    erasedBy: args.erasedBy,
    requestId: `data-retention:hardDelete:${args.entityName}:${args.rowId}`,
  });
}
