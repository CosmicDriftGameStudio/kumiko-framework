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

import { selectMany, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { encryptFailureError } from "../../job-run-logger";
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

  // Fetch the matched rows first: `error` carries the same per-triggering-
  // user subject annotation as job-run-logger.ts's onJobFailed path
  // (personal: { of: "triggeredById" } on job-run-table.ts), and a batch
  // updateMany can't encrypt per-row — different matched runs can belong to
  // different users, each under their own DEK. One updateMany per row keeps
  // this crash-recovery sweep's write on the same encrypted footing as the
  // normal failure path instead of writing STALE_JOB_RUN_ERROR in the clear.
  const stale = await selectMany<{ id: string; triggeredById: string | null }>(db, jobRunsTable, {
    status: "running",
    startedAt: { lt: cutoff },
  });

  // duration is deliberately left untouched: we don't know when the run
  // actually died, only that it crossed the timeout, so recording a
  // duration would misrepresent it as measured. detail-screen/list-screen
  // both already render a null duration as "—".
  let runsMarkedFailed = 0;
  for (const run of stale) {
    const encryptedError = await encryptFailureError(STALE_JOB_RUN_ERROR, run.triggeredById);
    const updated = await updateMany(
      db,
      jobRunsTable,
      {
        status: "failed",
        error: encryptedError,
        finishedAt: now,
        modifiedAt: now,
        modifiedById: "system",
      },
      // Re-assert status: "running" here (not just id) — closes the race
      // window between the selectMany above and this write, where the run
      // could have completed/failed normally in between and must not be
      // clobbered back to "failed" with the stale-timeout message.
      { id: run.id, status: "running" },
    );
    runsMarkedFailed += updated.length;
  }

  return { runsMarkedFailed };
}
