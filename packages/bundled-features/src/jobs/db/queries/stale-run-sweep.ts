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

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { deleteManyBatched, selectMany, updateMany } from "@cosmicdrift/kumiko-framework/db";
import { mapWithConcurrency } from "../../../shared/index.ts";
import { DEFAULT_JOB_RUN_RETENTION_DAYS } from "../../handlers/retention-cleanup.job.ts";
import { encryptFailureError } from "../../job-run-logger.ts";
import { jobRunsTable } from "../../job-run-table.ts";
import { tenantJobRunsTable } from "../../tenant-job-run-table.ts";

const KMS_POOL_CONCURRENCY = 4;
const STALE_DELETE_BATCH_SIZE = 500;

export const STALE_JOB_RUN_ERROR =
  "job run exceeded the stale-run timeout without a completion signal (likely a crashed worker process)";

export type StaleRunSweepResult = {
  readonly runsMarkedFailed: number;
  readonly tenantRunsMarkedFailed: number;
  readonly tenantQueuedDropped: number;
};

// A queued tenant row can legitimately wait much longer than a run takes (backlog, delay/backoff,
// sequential requeue), so it is only treated as lost once it is older than the retention window,
// not after the running-timeout.
export async function markStaleJobRunsFailed(
  db: DbConnection,
  timeoutHours: number,
  queuedRetentionDays: number = DEFAULT_JOB_RUN_RETENTION_DAYS,
): Promise<StaleRunSweepResult> {
  const cutoff = Temporal.Now.instant().subtract({ hours: timeoutHours });
  const queuedCutoff = Temporal.Now.instant().subtract({ hours: queuedRetentionDays * 24 });
  const now = Temporal.Now.instant();

  // Fetch the matched rows first: `error` carries the same per-triggering-
  // user subject annotation as job-run-logger.ts's onJobFailed path
  // (personal: { of: "triggeredById" } on job-run-table.ts), so it is encrypted
  // under the triggering user's DEK, or the system tenant key when
  // triggeredById is null (whenAbsent: "tenant", fw#3654). Runs are grouped by
  // that subject: one encrypt and one updateMany per subject instead of per run.
  const stale = await selectMany<{ id: string; triggeredById: string | null }>(db, jobRunsTable, {
    status: "running",
    startedAt: { lt: cutoff },
  });

  const idsBySubject = new Map<string | null, string[]>();
  for (const run of stale) {
    const ids = idsBySubject.get(run.triggeredById);
    if (ids) ids.push(run.id);
    else idsBySubject.set(run.triggeredById, [run.id]);
  }

  // duration is deliberately left untouched: we don't know when the run
  // actually died, only that it crossed the timeout, so recording a
  // duration would misrepresent it as measured. detail-screen/list-screen
  // both already render a null duration as "—".
  const updatedPerSubject = await mapWithConcurrency(
    [...idsBySubject],
    KMS_POOL_CONCURRENCY,
    async ([triggeredById, ids]) => {
      const encryptedError = await encryptFailureError(STALE_JOB_RUN_ERROR, triggeredById);
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
        // Re-assert status: "running" (not just id) — closes the race window
        // between the selectMany above and this write, where a run could have
        // completed/failed normally and must not be clobbered back to "failed".
        { id: { in: ids }, status: "running" },
      );
      return updated.length;
    },
  );
  const runsMarkedFailed = updatedPerSubject.reduce((sum, count) => sum + count, 0);

  // Tenant-visible run state follows the same clock: a running row whose
  // worker died is a failure, a queued row that never started (job lost from
  // Redis, enqueue hook without a run) would otherwise show "waiting" forever;
  // it is dropped once it has outlived the retention window.
  const tenantRunsFailed = await updateMany(
    db,
    tenantJobRunsTable,
    { status: "failed", finishedAt: now, updatedAt: now },
    { status: "running", startedAt: { lt: cutoff } },
  );
  const tenantQueuedStale = await deleteManyBatched(
    db,
    tenantJobRunsTable,
    { status: "queued", updatedAt: { lt: queuedCutoff } },
    { limit: STALE_DELETE_BATCH_SIZE },
  );

  return {
    runsMarkedFailed,
    tenantRunsMarkedFailed: tenantRunsFailed.length,
    tenantQueuedDropped: tenantQueuedStale.deleted,
  };
}
