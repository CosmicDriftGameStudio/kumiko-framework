import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

function quoteTable(tableName: string): string {
  return `"${tableName.replace(/"/g, '""')}"`;
}

function bindJsonbParam(value: unknown): { sql: string; bound: unknown } {
  // Scalar JSON primitives can't bind directly to ::jsonb — Postgres rejects a
  // bound boolean/number with "cannot cast type boolean/integer to jsonb" (and
  // Bun.SQL infers boolean[] candidates). Route them through ::text::jsonb with
  // a JSON-encoded literal. Objects/arrays/strings already bind as ::jsonb.
  if (typeof value === "boolean" || typeof value === "number") {
    return { sql: "$1::text::jsonb", bound: JSON.stringify(value) };
  }
  // JSON.stringify throws on bigint; its decimal string is a valid JSON number literal.
  if (typeof value === "bigint") {
    return { sql: "$1::text::jsonb", bound: value.toString() };
  }
  return { sql: "$1::jsonb", bound: value };
}

// Security invariant: aggregateId is a global row UUID, so without the tenant_id
// filter tenant A could mutate tenant B's row by its UUID (cf. removeCustomFieldKeyForTenant).
export async function setCustomFieldValue(
  db: DbRunner,
  tableName: string,
  fieldKey: string,
  value: unknown,
  aggregateId: string,
  tenantId: TenantId,
): Promise<void> {
  const tbl = quoteTable(tableName);
  const escapedKey = fieldKey.replace(/'/g, "''");
  const jsonb = bindJsonbParam(value);
  await asRawClient(db).unsafe(
    `UPDATE ${tbl} SET custom_fields = jsonb_set(custom_fields, '{${escapedKey}}', ${jsonb.sql}, true) WHERE id = $2 AND tenant_id = $3`,
    [jsonb.bound, aggregateId, tenantId],
  );
}

export async function clearCustomFieldKey(
  db: DbRunner,
  tableName: string,
  fieldKey: string,
  aggregateId: string,
  tenantId: TenantId,
): Promise<void> {
  const tbl = quoteTable(tableName);
  await asRawClient(db).unsafe(
    `UPDATE ${tbl} SET custom_fields = custom_fields - $1 WHERE id = $2 AND tenant_id = $3`,
    [fieldKey, aggregateId, tenantId],
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
  tenantId: TenantId,
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
