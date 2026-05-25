import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";

export async function selectFieldDefinitionsWithSerialized(
  db: DbRunner,
  entityName: string,
  tenantId: string,
): Promise<readonly { field_key: string; serialized_field: unknown }[]> {
  return asRawClient(db).unsafe(
    "SELECT field_key, serialized_field FROM read_custom_field_definitions WHERE entity_name = $1 AND tenant_id = $2",
    [entityName, tenantId],
  ) as Promise<readonly { field_key: string; serialized_field: unknown }[]>;
}

export async function selectHostRowsWithCustomFields(
  db: DbRunner,
  tableName: string,
  tenantId: string,
): Promise<readonly unknown[]> {
  const quoted = `"${tableName.replace(/"/g, '""')}"`;
  const rowsResult = await asRawClient(db).unsafe(
    `SELECT id, modified_at, custom_fields FROM ${quoted} WHERE tenant_id = $1 AND custom_fields IS NOT NULL`,
    [tenantId],
  );
  return Array.isArray(rowsResult) ? rowsResult : [];
}

export async function updateHostRowCustomFields(
  db: DbRunner,
  tableName: string,
  customFields: Record<string, unknown>,
  rowId: string,
): Promise<void> {
  const quoted = `"${tableName.replace(/"/g, '""')}"`;
  await asRawClient(db).unsafe(`UPDATE ${quoted} SET custom_fields = $1::jsonb WHERE id = $2`, [
    customFields,
    rowId,
  ]);
}
