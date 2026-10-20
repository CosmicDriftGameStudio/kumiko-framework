import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { deleteRowsWithoutReplayableStream } from "@cosmicdrift/kumiko-framework/event-store";
import { type PruneEventsOptions, pruneEvents } from "@cosmicdrift/kumiko-framework/pipeline";
import { deliveryAttemptsTable } from "./tables.ts";

export const DEFAULT_ATTEMPT_LOG_RETENTION_DAYS = 90;
const ROW_DELETE_BATCH_SIZE = 1000;

export type AttemptLogRetentionOptions = Pick<PruneEventsOptions, "olderThan" | "olderThanDays">;

export function resolveAttemptLogRetentionDays(
  option: number | false | undefined,
): number | undefined {
  if (option === false) return undefined;
  const days = option ?? DEFAULT_ATTEMPT_LOG_RETENTION_DAYS;
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(
      `delivery: attemptLogRetentionDays must be a positive integer or false, got ${String(option)}`,
    );
  }
  return days;
}

// Prunes the attempt events first and then the projection rows older than the same cutoff: a
// rebuild would not recreate rows whose events are gone, so they would otherwise stay forever.
// A lagging event consumer makes pruneEvents throw ConsumerLagError before anything is deleted;
// the caller retries on its next run.
export async function runAttemptLogRetention(
  db: DbConnection,
  options: AttemptLogRetentionOptions,
): Promise<{ readonly deletedEvents: number; readonly deletedRows: number }> {
  const pruned = await pruneEvents(db, { ...options, aggregateTypes: ["deliveryAttempt"] });
  let deletedRows = 0;
  let afterId: string | undefined;
  for (;;) {
    const page = await selectMany<{ id: string }>(
      db,
      deliveryAttemptsTable,
      {
        createdAt: { lt: pruned.cutoff },
        ...(afterId === undefined ? {} : { id: { gt: afterId } }),
      },
      { fields: ["id"], orderBy: { col: "id", direction: "asc" }, limit: ROW_DELETE_BATCH_SIZE },
    );
    if (page.length === 0) break;
    const deleted = await deleteRowsWithoutReplayableStream(db, {
      table: deliveryAttemptsTable,
      ids: page.map((row) => row.id),
    });
    deletedRows += deleted.length;
    if (page.length < ROW_DELETE_BATCH_SIZE) break;
    afterId = page[page.length - 1]?.id;
  }
  return { deletedEvents: pruned.deletedCount, deletedRows };
}
