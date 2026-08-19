// Job-run retention (#2243): jobRunsTable/jobRunLogsTable are direct-write
// stores now, not event-sourced projections — nothing else purges them, so
// without this job they grow forever with the run count instead of the
// runtime. Logs are deleted first (their run_id would otherwise point at a
// row that's already gone) — order matters even though run_id isn't a real
// FK constraint, see job-run-table.ts. Plain SQL, not the retention-cleanup
// executor: that executor is entity/tenant-scoped and jobRun has neither
// (system-scoped direct-write store).

import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { JobHandlerFn } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";

// Single source for the retention window — change here, nowhere else.
export const DEFAULT_JOB_RUN_RETENTION_DAYS = 30;

export type JobRunRetentionResult = {
  readonly runsDeleted: number;
  readonly logsDeleted: number;
};

export async function deleteStaleJobRuns(
  db: DbConnection,
  retentionDays: number,
): Promise<JobRunRetentionResult> {
  const client = asRawClient(db);
  const deletedLogs = (await client.unsafe(
    `DELETE FROM "store_job_run_logs"
     WHERE "run_id" IN (
       SELECT "id"::text FROM "store_job_runs"
       WHERE "inserted_at" < now() - ($1::int * interval '1 day')
     )
     RETURNING "id"`,
    [retentionDays],
  )) as readonly { id: string }[];
  const deletedRuns = (await client.unsafe(
    `DELETE FROM "store_job_runs"
     WHERE "inserted_at" < now() - ($1::int * interval '1 day')
     RETURNING "id"`,
    [retentionDays],
  )) as readonly { id: string }[];
  return { runsDeleted: deletedRuns.length, logsDeleted: deletedLogs.length };
}

export function createRetentionCleanupJob(retentionDays: number): JobHandlerFn {
  return async (_payload, ctx) => {
    if (!ctx.db) {
      throw new InternalError({
        message:
          "[jobs:retention-cleanup] ctx.db missing — job context requires a database connection.",
      });
    }
    const db = ctx.db as DbConnection; // @cast-boundary db-operator (matches sibling cron jobs)
    const result = await deleteStaleJobRuns(db, retentionDays);
    ctx.log?.info?.(`[jobs:retention-cleanup] complete: ${JSON.stringify(result)}`);
  };
}
