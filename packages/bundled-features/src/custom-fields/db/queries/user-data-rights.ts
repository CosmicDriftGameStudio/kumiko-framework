import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { unsafeReadRetrying } from "@cosmicdrift/kumiko-framework/db";
import { quoteIdent } from "./projection.ts";

export async function selectCustomFieldsHostRows(
  db: DbRunner,
  tableName: string,
  userIdColumn: string,
  userId: string,
  tenantId: string,
): Promise<readonly unknown[]> {
  const tbl = quoteIdent(tableName);
  const userCol = quoteIdent(userIdColumn);
  const rowsResult = await unsafeReadRetrying(
    db,
    `SELECT id, custom_fields FROM ${tbl} WHERE ${userCol} = $1 AND tenant_id = $2`,
    [userId, tenantId],
  );
  return Array.isArray(rowsResult) ? rowsResult : [];
}
