import { asRawClient } from "../bun-db/query";
import type { DbConnection } from "../db/connection";
import type { EntityTableMeta } from "../db/entity-table-meta";
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
// CREATE INDEX statements which we execute via asRawClient. No drizzle-kit
// roundtrip needed.
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
 * and executes them via the raw client. Idempotent re-runs are safe.
 *
 * Reserved for framework-internal meta-tables + test setup. App-defined
 * entities go through `kumiko schema apply` (committed SQL files).
 */
export async function unsafePushTables(
  db: DbConnection,
  tables: Record<string, unknown>,
  _prevTables?: Record<string, unknown>,
): Promise<void> {
  const raw = asRawClient(db);
  for (const table of Object.values(tables)) {
    const meta = tableToMeta(table);
    const statements = renderTableDdl(meta);
    for (const stmt of statements) {
      await raw.unsafe(stmt);
    }
  }
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
  const allTables = [...frameworkTables, ...extraNames];
  await asRawClient(stack.db).unsafe(`TRUNCATE ${allTables.join(", ")} RESTART IDENTITY CASCADE`);
  if (stack.eventDispatcher) {
    await stack.eventDispatcher.ensureRegistered();
  }
}
