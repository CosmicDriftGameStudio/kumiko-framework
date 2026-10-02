import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

export type DueRow = { readonly run_id: string; readonly step_index: number };

// Oldest first and capped, so a backlog after an outage drains over several
// ticks instead of holding one tick's `concurrency: "skip"` slot for minutes.
export const DUE_RUNS_BATCH_SIZE = 100;

// Dedup happens solely via resume-run's VersionConflictError-checked claim
// (ctx.tryAppendEvent on WORKFLOW_RESUMED) — a second dispatch for the same
// row loses that race and no-ops. No row locks: in an autocommit statement
// they would be released right after the SELECT and guard nothing.
export async function selectDueWorkflowRunPending(
  db: DbConnection,
  tenantId: TenantId,
): Promise<readonly DueRow[]> {
  // kumiko-lint-ignore raw-sql tenant-scoped due-row pickup
  return (await asRawClient(db).unsafe(
    `SELECT run_id, step_index FROM workflow_run_pending WHERE tenant_id = $1 AND wake_at < now() ORDER BY wake_at ASC LIMIT ${DUE_RUNS_BATCH_SIZE}`,
    [tenantId],
  )) as readonly DueRow[];
}
