import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { unsafeReadRetrying } from "@cosmicdrift/kumiko-framework/db";

function quoteTable(tableName: string): string {
  return `"${tableName.replace(/"/g, '""')}"`;
}

function quoteColumn(columnName: string): string {
  return `"${columnName.replace(/"/g, '""')}"`;
}

export async function selectCustomFieldsHostRows(
  db: DbRunner,
  tableName: string,
  userIdColumn: string,
  userId: string,
  tenantId: string,
): Promise<readonly unknown[]> {
  const tbl = quoteTable(tableName);
  const userCol = quoteColumn(userIdColumn);
  const rowsResult = await unsafeReadRetrying(
    db,
    `SELECT id, custom_fields FROM ${tbl} WHERE ${userCol} = $1 AND tenant_id = $2`,
    [userId, tenantId],
  );
  return Array.isArray(rowsResult) ? rowsResult : [];
}
