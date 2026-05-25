import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";

export async function countAssetsForTenant(db: DbRunner, tenantId: string): Promise<number> {
  const rows = await asRawClient(db).unsafe<{ count: number }>(
    `SELECT count(*)::int AS count FROM read_assets WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows[0]?.count ?? 0;
}

export async function countTicketsForTenant(db: DbRunner, tenantId: string): Promise<number> {
  const rows = await asRawClient(db).unsafe<{ count: number }>(
    `SELECT count(*)::int AS count FROM read_tickets WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows[0]?.count ?? 0;
}
