import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";

function quoteTable(tableName: string): string {
  return `"${tableName.replace(/"/g, '""')}"`;
}

function bindJsonbParam(value: unknown): { sql: string; bound: unknown } {
  // postgres-js infers boolean params as boolean[] candidates — route via text::jsonb.
  if (typeof value === "boolean") {
    return { sql: "$1::text::jsonb", bound: JSON.stringify(value) };
  }
  return { sql: "$1::jsonb", bound: value };
}

export async function setCustomFieldValue(
  db: DbRunner,
  tableName: string,
  fieldKey: string,
  value: unknown,
  aggregateId: string,
): Promise<void> {
  const tbl = quoteTable(tableName);
  const escapedKey = fieldKey.replace(/'/g, "''");
  const jsonb = bindJsonbParam(value);
  await asRawClient(db).unsafe(
    `UPDATE ${tbl} SET custom_fields = jsonb_set(custom_fields, '{${escapedKey}}', ${jsonb.sql}, true) WHERE id = $2`,
    [jsonb.bound, aggregateId],
  );
}

export async function clearCustomFieldKey(
  db: DbRunner,
  tableName: string,
  fieldKey: string,
  aggregateId: string,
): Promise<void> {
  const tbl = quoteTable(tableName);
  await asRawClient(db).unsafe(
    `UPDATE ${tbl} SET custom_fields = custom_fields - $1 WHERE id = $2`,
    [fieldKey, aggregateId],
  );
}

export async function removeCustomFieldKeyFromAllRows(
  db: DbRunner,
  tableName: string,
  fieldKey: string,
): Promise<void> {
  const tbl = quoteTable(tableName);
  await asRawClient(db).unsafe(`UPDATE ${tbl} SET custom_fields = custom_fields - $1`, [fieldKey]);
}
