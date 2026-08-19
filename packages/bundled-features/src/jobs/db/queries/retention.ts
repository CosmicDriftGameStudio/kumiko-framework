// Job-run retention (#2243): store_job_runs/store_job_run_logs are
// direct-write stores now, not event-sourced projections — nothing else
// purges them, so without this query they grow forever with the run count
// instead of the runtime. Not the retention-cleanup executor: that executor
// is entity/tenant-scoped and jobRun has neither (system-scoped direct-write
// store). Each table is purged by its own timestamp column independently —
// run_id isn't a real FK constraint (see job-run-table.ts), so there is no
// ordering requirement between the two deletes.
//
// deleteManyBatched (typed query API, no raw SQL in this file) chunks each
// delete so a large backlog doesn't hold one lock for the whole sweep.

import { deleteManyBatched } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { jobRunLogsTable, jobRunsTable } from "../../job-run-table";

const RETENTION_DELETE_BATCH_SIZE = 500;

export type JobRunRetentionResult = {
  readonly runsDeleted: number;
  readonly logsDeleted: number;
};

export async function deleteStaleJobRuns(
  db: DbConnection,
  retentionDays: number,
): Promise<JobRunRetentionResult> {
  const cutoff = Temporal.Now.instant().subtract({ hours: retentionDays * 24 });

  const logsResult = await deleteManyBatched(
    db,
    jobRunLogsTable,
    { timestamp: { lt: cutoff } },
    { limit: RETENTION_DELETE_BATCH_SIZE },
  );
  const runsResult = await deleteManyBatched(
    db,
    jobRunsTable,
    { insertedAt: { lt: cutoff } },
    { limit: RETENTION_DELETE_BATCH_SIZE },
  );

  return { runsDeleted: runsResult.deleted, logsDeleted: logsResult.deleted };
}
