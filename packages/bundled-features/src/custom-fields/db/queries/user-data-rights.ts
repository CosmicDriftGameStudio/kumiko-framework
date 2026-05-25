import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";

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
  const rowsResult = await asRawClient(db).unsafe(
    `SELECT id, custom_fields FROM ${tbl} WHERE ${userCol} = $1 AND tenant_id = $2`,
    [userId, tenantId],
  );
  return Array.isArray(rowsResult) ? rowsResult : [];
}

export async function stripSensitiveCustomFieldKeys(
  db: DbRunner,
  tableName: string,
  userIdColumn: string,
  sensitiveKeys: readonly string[],
  userId: string,
  tenantId: string,
): Promise<void> {
  const tbl = quoteTable(tableName);
  const userCol = quoteColumn(userIdColumn);
  await asRawClient(db).unsafe(
    `UPDATE ${tbl} SET custom_fields = CASE
       WHEN jsonb_typeof(custom_fields) = 'object' THEN custom_fields - $1::text[]
       ELSE custom_fields
     END
     WHERE ${userCol} = $2 AND tenant_id = $3`,
    [sensitiveKeys, userId, tenantId],
  );
}

export async function selectFieldDefinitionsForEntity(
  db: DbRunner,
  entityName: string,
  tenantId: string,
): Promise<readonly { field_key: string; serialized_field: unknown }[]> {
  return asRawClient(db).unsafe(
    "SELECT field_key, serialized_field FROM read_custom_field_definitions WHERE entity_name = $1 AND tenant_id = $2",
    [entityName, tenantId],
  ) as Promise<readonly { field_key: string; serialized_field: unknown }[]>;
}
