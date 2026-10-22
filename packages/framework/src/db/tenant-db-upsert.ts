import type { EntityTableMeta } from "@cosmicdrift/kumiko-types/entity-table-meta-types";
import type {
  TenantDbMode,
  TenantDbUpsertOptions,
} from "@cosmicdrift/kumiko-types/tenant-db-types";
import { quoteIdent } from "../crypto/ciphertext-pattern.ts";
import { AccessDeniedError } from "../errors/index.ts";
import { isExecutorManagedTable } from "./executor-managed-tables.ts";
import {
  type AnyDb,
  buildInsertSql,
  coerceRow,
  conflictUpdateParts,
  insertEntries,
  type TableLike,
  unsafeLoggingClosedConnection,
} from "./query.ts";
import { extractTableInfo } from "./table-info.ts";
import { asEntityTableMeta, tableNameOf } from "./table-introspection.ts";

const TENANT_COLUMN = "tenant_id";

// Upsert is never allowed on event-fed tables (even with the write capability) and has no tenant-mode meaning for "global" ones.
export function upsertTableDenied(
  table: TableLike,
  mode: TenantDbMode,
): AccessDeniedError | undefined {
  if (isExecutorManagedTable(table)) {
    return new AccessDeniedError({
      message: `ctx.db.upsert(${tableNameOf(table)}): table is fed by events; upsert is not supported on it.`,
    });
  }
  if (mode === "tenant" && asEntityTableMeta(table)?.tenancy === "global") {
    return new AccessDeniedError({
      message:
        `ctx.db.upsert(${tableNameOf(table)}): "global" table rows must carry SYSTEM_TENANT_ID; ` +
        "use db.global(table) with escapeHatch instead.",
    });
  }
  return undefined;
}

function sameColumnSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && new Set(a).size === a.length && a.every((c) => b.includes(c));
}

function declaredUniqueColumnSets(meta: EntityTableMeta): (readonly string[])[] {
  const sets: (readonly string[])[] = meta.indexes
    .filter((i) => i.unique === true && i.whereSql === undefined && i.needsManualWhere !== true)
    .map((i) => i.columns);
  if (meta.compositePrimaryKey) sets.push(meta.compositePrimaryKey.columns);
  const primaryKeyColumns = meta.columns.filter((c) => c.primaryKey).map((c) => c.name);
  if (primaryKeyColumns.length > 0) sets.push(primaryKeyColumns);
  return sets;
}

function primaryKeyColumnsOf(meta: EntityTableMeta): readonly string[] {
  return [
    ...meta.columns.filter((c) => c.primaryKey).map((c) => c.name),
    ...(meta.compositePrimaryKey?.columns ?? []),
  ];
}

function assertTenantSafeConflictTarget(
  tableName: string,
  meta: EntityTableMeta,
  conflictCols: readonly string[],
): void {
  if (conflictCols.length === 0 || !conflictCols.includes(TENANT_COLUMN)) {
    throw new Error(
      `tenantDb.upsert(${tableName}): conflictTarget must include "tenantId" — a target without it ` +
        "could match, and overwrite, another tenant's row.",
    );
  }
  if (!declaredUniqueColumnSets(meta).some((set) => sameColumnSet(set, conflictCols))) {
    throw new Error(
      `tenantDb.upsert(${tableName}): conflictTarget (${conflictCols.join(", ")}) matches no ` +
        "declared unique index (without a WHERE clause) or primary key.",
    );
  }
}

// Handles a tenant's own row only: values carry the tenant already, and the DO UPDATE guard
// compares against the tenant being inserted, so a conflict on another tenant's row updates nothing.
export async function upsertTenantRow<TRow>(
  db: AnyDb,
  table: TableLike,
  values: Record<string, unknown>,
  options: TenantDbUpsertOptions,
): Promise<TRow | undefined> {
  const info = extractTableInfo(table);
  const meta = asEntityTableMeta(table);
  if (!info.hasColumn("tenantId")) {
    throw new Error(
      `tenantDb.upsert(${info.name}): table has no tenant column — use the free upsertOnConflict ` +
        "helper on an unsafeRaw runner instead.",
    );
  }
  if (!meta) {
    throw new Error(
      `tenantDb.upsert(${info.name}): needs an EntityTableMeta table (declared unique indexes and primary key), got a table without meta.`,
    );
  }
  const conflictCols = options.conflictTarget.map((field) => info.columnOf(field));
  assertTenantSafeConflictTarget(info.name, meta, conflictCols);

  if (
    options.update &&
    Object.keys(options.update).some((f) => info.columnOf(f) === TENANT_COLUMN)
  ) {
    throw new Error(
      `tenantDb.upsert(${info.name}): update must not set "tenantId" — it would move the row into another tenant.`,
    );
  }

  const entries = insertEntries(info, values);
  if (!entries.some((e) => e.col === TENANT_COLUMN)) {
    throw new Error(`tenantDb.upsert(${info.name}): values carry no tenantId.`);
  }
  const { sqlPrefix, params } = buildInsertSql(info, entries);
  const skipCols = new Set([...conflictCols, ...primaryKeyColumnsOf(meta), TENANT_COLUMN]);
  const setParts = conflictUpdateParts(info, entries, options.update, skipCols, params);
  if (setParts.length === 0) {
    throw new Error(`tenantDb.upsert(${info.name}): nothing to update on conflict`);
  }

  const tenantRef = quoteIdent(TENANT_COLUMN);
  const sqlText =
    `${sqlPrefix} ON CONFLICT (${conflictCols.map((c) => quoteIdent(c)).join(", ")}) ` +
    `DO UPDATE SET ${setParts.join(", ")} ` +
    `WHERE ${quoteIdent(info.name)}.${tenantRef} = EXCLUDED.${tenantRef} RETURNING *`;
  const rows = await unsafeLoggingClosedConnection<Record<string, unknown>>(db, sqlText, params, {
    operation: "tenantDb.upsert",
    table: info.name,
  });
  const first = rows[0];
  return first ? coerceRow<TRow>(first, info) : undefined;
}
