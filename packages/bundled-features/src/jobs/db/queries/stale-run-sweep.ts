// Stale job-run sweep (#2246): store_job_runs is a direct-write store
// (#2243) — status is set to "running" once at onJobStart and only ever
// flipped to "completed"/"failed" by onJobComplete/onJobFailed. If the
// process dies mid-run (crash, OOM, kill -9), those callbacks never fire and
// the row is stuck on "running" forever — nothing else on the read side
// (list.query.ts/detail.query.ts) or in job-runner.ts (no BullMQ 'stalled'
// listener wired) ever revisits it.
//
// This sweep marks runs whose startedAt is older than the timeout as
// "failed" instead of inventing a new status: reusing "failed" means no
// schema/migration change, no web filter-dropdown/status-enum update, and
// the run becomes retriable via the existing jobs:write:retry gate
// (retry.write.ts only allows retry from "failed").

import { updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { jobRunsTable } from "../../job-run-table";

export const STALE_JOB_RUN_ERROR =
  "job run exceeded the stale-run timeout without a completion signal (likely a crashed worker process)";

export type StaleRunSweepResult = {
  readonly runsMarkedFailed: number;
};

export async function markStaleJobRunsFailed(
  db: DbConnection,
  timeoutHours: number,
): Promise<StaleRunSweepResult> {
  const cutoff = Temporal.Now.instant().subtract({ hours: timeoutHours });
  const now = Temporal.Now.instant();

  // duration is deliberately left untouched: we don't know when the run
  // actually died, only that it crossed the timeout, so recording a
  // duration would misrepresent it as measured. detail-screen/list-screen
  // both already render a null duration as "—".
  const updated = await updateMany(
    db,
    jobRunsTable,
    {
      status: "failed",
      error: STALE_JOB_RUN_ERROR,
      finishedAt: now,
      modifiedAt: now,
      modifiedById: "system",
    },
    { status: "running", startedAt: { lt: cutoff } },
  );

  return { runsMarkedFailed: updated.length };
}
