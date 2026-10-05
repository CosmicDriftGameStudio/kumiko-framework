import { deleteManyBatched } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { type PruneEventsOptions, pruneEvents } from "@cosmicdrift/kumiko-framework/pipeline";
import { deliveryAttemptsTable } from "./tables.js";

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
  const rows = await deleteManyBatched(
    db,
    deliveryAttemptsTable,
    { createdAt: { lt: pruned.cutoff } },
    { limit: ROW_DELETE_BATCH_SIZE },
  );
  return { deletedEvents: pruned.deletedCount, deletedRows: rows.deleted };
}
