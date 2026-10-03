import { sql, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { workflowRunPendingTable } from "../../tables.js";

export type DueRow = { readonly runId: string; readonly stepIndex: number };

// Oldest first and capped, so a backlog after an outage drains over several
// ticks instead of holding one tick's `concurrency: "skip"` slot for minutes.
export const DUE_RUNS_BATCH_SIZE = 100;

// Dedup happens solely via resume-run's VersionConflictError-checked claim
// (ctx.tryAppendEvent on WORKFLOW_RESUMED) — a second dispatch for the same
// row loses that race and no-ops. No row locks: in an autocommit statement
// they would be released right after the SELECT and guard nothing.
// `now()` stays the DB clock so job-host clock skew cannot mark rows due early.
export function selectDueWorkflowRunPending(db: TenantDb): Promise<readonly DueRow[]> {
  return db.selectMany<DueRow>(
    workflowRunPendingTable,
    { wakeAt: { lt: sql`now()` } },
    { orderBy: { col: "wakeAt", direction: "asc" }, limit: DUE_RUNS_BATCH_SIZE },
  );
}
