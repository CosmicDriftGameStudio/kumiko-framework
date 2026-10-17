import type { EntityDefinition } from "../engine/types/index.js";
import type { DbConnection } from "./connection.js";
import { pgTypeToSqlType } from "./dialect.js";
import type { ColumnMeta, EntityTableMeta, IndexMeta } from "./entity-table-meta.js";
import { alterTableAddColumn, createIndexIfNotExists, executeDdlStatement } from "./queries/ddl.js";
import { renderTableDdl } from "./render-ddl.js";
import { tableExists } from "./schema-inspection.js";
import { buildEntityTable, toTableName } from "./table-builder.js";
import { asEntityTableMeta } from "./table-introspection.js";

/**
 * Bypass: creates an entity-table directly without going through the
 * full registry. Reserved for framework-internal meta-tables and
 * test setup — apps declare data via `r.entity(...)`.
 */
export async function unsafeCreateEntityTable(
  db: DbConnection,
  entity: EntityDefinition,
  entityName?: string,
): Promise<void> {
  const table = buildEntityTable(entityName ?? "entity", entity);
  await unsafePushTables(db, { [entityName ?? "entity"]: table });
}

export async function unsafeEnsureEntityTable(
  db: DbConnection,
  entity: EntityDefinition,
  entityName?: string,
): Promise<boolean> {
  const resolvedName = entity.table ?? toTableName(entityName ?? "entity");
  if (await tableExists(db, `public.${resolvedName}`)) return false;
  await unsafeCreateEntityTable(db, entity, entityName);
  return true;
}

// Tables produced by the native dialect already carry EntityTableMeta-shape
// (source/columns/indexes). renderTableDdl converts that to CREATE TABLE +
// CREATE INDEX statements executed via db/queries/test-stack.
export function tableToMeta(table: unknown): EntityTableMeta {
  const meta = asEntityTableMeta(table);
  if (!meta) throw new Error("unsafePushTables: argument is not a SchemaTable / EntityTableMeta");
  return meta;
}

/** Applies ALTER TABLE ADD COLUMN for exactly the given columns. */
export async function addMissingColumns(
  db: DbConnection,
  tableName: string,
  columns: readonly ColumnMeta[],
): Promise<void> {
  for (const col of columns) {
    const type = renderColumnType(col);
    const notNull = col.notNull && !col.primaryKey ? " NOT NULL" : "";
    const defaultClause = col.defaultSql !== undefined ? ` DEFAULT ${col.defaultSql}` : "";
    await alterTableAddColumn(db, tableName, col.name, type, defaultClause, notNull);
  }
}

/** CREATE [UNIQUE] INDEX IF NOT EXISTS for exactly the given indexes. */
export async function addMissingIndexes(
  db: DbConnection,
  tableName: string,
  indexes: readonly IndexMeta[],
): Promise<void> {
  for (const idx of indexes) {
    const kind = idx.unique ? "UNIQUE INDEX" : "INDEX";
    const colList = idx.columns.map((c) => `"${c}"`).join(", ");
    await createIndexIfNotExists(db, kind, idx.name, tableName, colList, idx.whereSql);
  }
}

/**
 * Bypass: pushes table definitions to the database directly. Produces
 * CREATE TABLE IF NOT EXISTS + CREATE INDEX statements via renderTableDdl
 * and executes them via db/queries/test-stack. Idempotent re-runs are safe.
 *
 * Reserved for framework-internal meta-tables + test setup. App-defined
 * entities go through `kumiko schema apply` (committed SQL files).
 */
export async function unsafePushTables(
  db: DbConnection,
  tables: Record<string, unknown>,
  prevTables?: Record<string, unknown>,
): Promise<void> {
  const prevMetas = new Map<string, EntityTableMeta>();
  if (prevTables) {
    for (const [key, table] of Object.entries(prevTables)) {
      const meta = tableToMeta(table);
      prevMetas.set(key, meta);
    }
  }

  for (const [key, table] of Object.entries(tables)) {
    const meta = tableToMeta(table);
    const prev = prevMetas.get(key);

    if (prev) {
      const prevCols = new Set(prev.columns.map((c) => c.name));
      const newCols = meta.columns.filter((c) => !prevCols.has(c.name));
      await addMissingColumns(db, meta.tableName, newCols);
      const prevIdxNames = new Set(prev.indexes.map((i) => i.name));
      await addMissingIndexes(
        db,
        meta.tableName,
        meta.indexes.filter((i) => !prevIdxNames.has(i.name)),
      );
    } else {
      const statements = renderTableDdl(meta);
      for (const stmt of statements) {
        await executeDdlStatement(db, stmt);
      }
    }
  }
}

// @wrapper-known semantic-alias
function renderColumnType(col: ColumnMeta): string {
  return pgTypeToSqlType(col.pgType);
}
