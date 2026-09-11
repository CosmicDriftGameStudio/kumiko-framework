import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";

// INSERT-once, not UPSERT: unlike subscriptionsProjectionTable (one row per
// tenant, state overwritten on every event), a payment row is an immutable
// fact keyed by event.id — ON CONFLICT DO NOTHING makes a projection
// rebuild/replay idempotent without ever mutating an existing row.
export async function insertPaymentProjectionRow(
  tx: DbRunner,
  tableName: string,
  insertCols: Record<string, unknown>,
): Promise<void> {
  const insertKeys = Object.keys(insertCols);
  const insertPlaceholders = insertKeys.map((_, i) => `$${i + 1}`);
  const sqlText = `INSERT INTO "${tableName}" (${insertKeys.map((k) => `"${k}"`).join(", ")}) VALUES (${insertPlaceholders.join(", ")}) ON CONFLICT ("id") DO NOTHING`;
  await asRawClient(tx).unsafe(sqlText, Object.values(insertCols));
}
