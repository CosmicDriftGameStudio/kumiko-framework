import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";

export async function countTasksForTenant(db: DbRunner, tenantId: string): Promise<number> {
  const rows = await asRawClient(db).unsafe<{ count: number }>(
    `SELECT count(*)::int AS count FROM read_ui_walkthrough_tasks WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows[0]?.count ?? 0;
}
