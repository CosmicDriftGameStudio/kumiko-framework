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

// Tenant-scoped orphan-cleanup: removes the jsonb key only from the deleting
// tenant's rows. This is the default path for tenant-field deletions — without
// the tenant_id filter, deleting tenant A's field strips the same kebab key
// from every tenant's rows (cross-tenant data loss).
export async function removeCustomFieldKeyForTenant(
  db: DbRunner,
  tableName: string,
  fieldKey: string,
  tenantId: string,
): Promise<void> {
  const tbl = quoteTable(tableName);
  await asRawClient(db).unsafe(
    `UPDATE ${tbl} SET custom_fields = custom_fields - $1 WHERE tenant_id = $2`,
    [fieldKey, tenantId],
  );
}

// Cross-tenant cleanup: strips the key from EVERY tenant's rows. Only valid for
// system-scope field-definition deletions (the field applied to all tenants).
// Never call this for a tenant-scoped deletion — use removeCustomFieldKeyForTenant.
export async function removeCustomFieldKeyFromAllTenants(
  db: DbRunner,
  tableName: string,
  fieldKey: string,
): Promise<void> {
  const tbl = quoteTable(tableName);
  await asRawClient(db).unsafe(`UPDATE ${tbl} SET custom_fields = custom_fields - $1`, [fieldKey]);
}
