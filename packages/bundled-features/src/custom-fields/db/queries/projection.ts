import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";

function quoteTable(tableName: string): string {
  return `"${tableName.replace(/"/g, '""')}"`;
}

export async function setCustomFieldValue(
  db: DbRunner,
  tableName: string,
  fieldKey: string,
  valueJson: string,
  aggregateId: string,
): Promise<void> {
  const tbl = quoteTable(tableName);
  const escapedKey = fieldKey.replace(/'/g, "''");
  await asRawClient(db).unsafe(
    `UPDATE ${tbl} SET custom_fields = jsonb_set(custom_fields, '{${escapedKey}}', $1::jsonb, true) WHERE id = $2`,
    [valueJson, aggregateId],
  );
}

export async function clearCustomFieldKey(
  db: DbRunner,
  tableName: string,
  fieldKey: string,
  aggregateId: string,
): Promise<void> {
  const tbl = quoteTable(tableName);
  await asRawClient(db).unsafe(`UPDATE ${tbl} SET custom_fields = custom_fields - $1 WHERE id = $2`, [
    fieldKey,
    aggregateId,
  ]);
}

export async function removeCustomFieldKeyFromAllRows(
  db: DbRunner,
  tableName: string,
  fieldKey: string,
): Promise<void> {
  const tbl = quoteTable(tableName);
  await asRawClient(db).unsafe(`UPDATE ${tbl} SET custom_fields = custom_fields - $1`, [fieldKey]);
}
