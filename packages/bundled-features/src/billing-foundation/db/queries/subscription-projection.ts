import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";

export async function upsertSubscriptionProjectionRow(
  tx: DbRunner,
  tableName: string,
  insertCols: Record<string, unknown>,
  setClauses: readonly string[],
  params: readonly unknown[],
): Promise<void> {
  const insertKeys = Object.keys(insertCols);
  const insertPlaceholders = insertKeys.map((_, i) => `$${i + 1}`);
  const sqlText = `INSERT INTO "${tableName}" (${insertKeys.map((k) => `"${k}"`).join(", ")}) VALUES (${insertPlaceholders.join(", ")}) ON CONFLICT ("id") DO UPDATE SET ${setClauses.join(", ")}`;
  await asRawClient(tx).unsafe(sqlText, params);
}
