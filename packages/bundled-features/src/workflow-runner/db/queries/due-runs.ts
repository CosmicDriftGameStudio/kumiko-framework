import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

export type DueRow = { readonly run_id: string; readonly step_index: number };

// Standalone statement (no db.begin) — FOR UPDATE SKIP LOCKED only
// needs to survive this one SELECT to reduce redundant dispatches
// under true concurrency; it auto-commits and releases the row locks
// immediately after. The real correctness guarantee is resume-run's
// VersionConflictError-checked claim (ctx.tryAppendEvent on
// WORKFLOW_RESUMED) — a second dispatch for the same row just loses
// that race and no-ops, same as the sample this was adapted from.
export async function selectDueWorkflowRunPending(
  db: DbConnection,
  tenantId: TenantId,
): Promise<readonly DueRow[]> {
  // kumiko-lint-ignore raw-sql tenant-scoped due-row pickup with FOR UPDATE SKIP LOCKED
  return (await asRawClient(db).unsafe(
    `SELECT run_id, step_index FROM workflow_run_pending WHERE tenant_id = $1 AND wake_at < now() FOR UPDATE SKIP LOCKED`,
    [tenantId],
  )) as readonly DueRow[];
}
