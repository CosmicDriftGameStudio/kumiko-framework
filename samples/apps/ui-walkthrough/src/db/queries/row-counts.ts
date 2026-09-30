import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";

type CountedTable = "read_ui_walkthrough_leases" | "read_ui_walkthrough_vehicles";

export async function countRowsForTenant(
  db: DbRunner,
  table: CountedTable,
  tenantId: string,
): Promise<number> {
  const rows = await asRawClient(db).unsafe<{ count: number }>(
    `SELECT count(*)::int AS count FROM ${table} WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows[0]?.count ?? 0;
}
