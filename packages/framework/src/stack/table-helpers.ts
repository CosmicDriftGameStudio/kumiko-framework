import type { DbConnection } from "../db/connection";
import { pgTypeToSqlType } from "../db/dialect";
import type { ColumnMeta, EntityTableMeta } from "../db/entity-table-meta";
import {
  alterTableAddColumn,
  createIndexIfNotExists,
  executeDdlStatement,
  truncateTablesRestartIdentity,
} from "../db/queries/test-stack";
import { renderTableDdl } from "../db/render-ddl";
import { tableExists } from "../db/schema-inspection";
import { buildEntityTable, toTableName } from "../db/table-builder";
import type { EventDispatcher } from "../pipeline";

const KUMIKO_NAME_SYMBOL = Symbol.for("kumiko:schema:Name");
function tableNameOf(table: unknown): string {
  if (typeof table !== "object" || table === null) {
    throw new Error("table-helpers: table is not a SchemaTable object");
  }
  const rec = table as Record<string | symbol, unknown>;
  if (typeof rec[KUMIKO_NAME_SYMBOL] === "string") return rec[KUMIKO_NAME_SYMBOL] as string;
  if (typeof (rec as { tableName?: unknown }).tableName === "string") {
    return (rec as { tableName: string }).tableName;
  }
  throw new Error("table-helpers: table has no name");
}

/**
 * Bypass: creates an entity-table directly without going through the
 * full registry. Reserved for framework-internal meta-tables and
 * test setup — apps declare data via `r.entity(...)`.
 */
export async function unsafeCreateEntityTable(
  db: DbConnection,
  entity: import("../engine/types").EntityDefinition,
  entityName?: string,
): Promise<void> {
  const table = buildEntityTable(entityName ?? "entity", entity);
  await unsafePushTables(db, { [entityName ?? "entity"]: table });
}

export async function unsafeEnsureEntityTable(
  db: DbConnection,
  entity: import("../engine/types").EntityDefinition,
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
function tableToMeta(table: unknown): EntityTableMeta {
  if (
    typeof table === "object" &&
    table !== null &&
    "tableName" in table &&
    "columns" in table &&
    "indexes" in table &&
    "source" in table
  ) {
    return table as EntityTableMeta;
  }
  throw new Error("unsafePushTables: argument is not a SchemaTable / EntityTableMeta");
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
      for (const col of meta.columns) {
        if (!prevCols.has(col.name)) {
          const type = renderColumnType(col);
          const notNull = col.notNull && !col.primaryKey ? " NOT NULL" : "";
          const defaultClause = col.defaultSql !== undefined ? ` DEFAULT ${col.defaultSql}` : "";
          await alterTableAddColumn(db, meta.tableName, col.name, type, defaultClause, notNull);
        }
      }
      const prevIdxNames = new Set(prev.indexes.map((i) => i.name));
      for (const idx of meta.indexes) {
        if (!prevIdxNames.has(idx.name)) {
          const kind = idx.unique ? "UNIQUE INDEX" : "INDEX";
          const colList = idx.columns.map((c) => `"${c}"`).join(", ");
          await createIndexIfNotExists(db, kind, idx.name, meta.tableName, colList);
        }
      }
    } else {
      const statements = renderTableDdl(meta);
      for (const stmt of statements) {
        await executeDdlStatement(db, stmt);
      }
    }
  }
}

function renderColumnType(col: ColumnMeta): string {
  return pgTypeToSqlType(col.pgType);
}

/**
 * Wipes event store + framework-state + the given feature read-models in
 * one TRUNCATE, then re-registers the event-consumer state rows. Used in
 * test beforeEach-hooks to return the stack to a clean slate without
 * rebuilding it.
 */
export async function resetEventStore(
  stack: { db: unknown; eventDispatcher?: EventDispatcher },
  extraTables: readonly (unknown | string)[] = [],
): Promise<void> {
  const frameworkTables = [
    "kumiko_events",
    "kumiko_event_consumers",
    "kumiko_archived_streams",
    "kumiko_snapshots",
    "kumiko_projections",
  ];
  const extraNames = extraTables.map((t) => (typeof t === "string" ? t : tableNameOf(t)));
  await truncateTablesRestartIdentity(stack.db, [...frameworkTables, ...extraNames]);
  if (stack.eventDispatcher) {
    await stack.eventDispatcher.ensureRegistered();
  }
}
