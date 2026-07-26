import type { AnyDb } from "../query";
import { asRawClient } from "../query";
import { quoteTableIdent } from "./table-ops";

// Generic DDL helpers used on the prod-boot path (stack/table-helpers.ts's
// unsafePushTables, event-consumer-state.ts's multi-instance backfill) —
// split out of queries/test-stack.ts so a prod-boot import doesn't point at
// a module named for test-only concerns (truncate/create/drop-database).

export async function executeDdlStatement(db: AnyDb, sqlText: string): Promise<void> {
  await asRawClient(db).unsafe(sqlText);
}

export async function alterTableAddColumn(
  db: AnyDb,
  tableName: string,
  columnName: string,
  columnType: string,
  defaultClause: string,
  notNull: string,
  // table-helpers.ts's unmanaged-table sync relies on the plain form
  // throwing when a column already exists with a different shape than
  // EntityTableMeta expects — that's how it surfaces drift. Callers that
  // just need an idempotent, race-safe backfill (e.g. event-consumer-state's
  // multi-instance boot path, #1362) opt in explicitly.
  ifNotExists = false,
): Promise<void> {
  await asRawClient(db).unsafe(
    `ALTER TABLE ${quoteTableIdent(tableName)} ADD COLUMN ${ifNotExists ? "IF NOT EXISTS " : ""}${quoteTableIdent(columnName)} ${columnType}${defaultClause}${notNull}`,
  );
}

export async function createIndexIfNotExists(
  db: AnyDb,
  indexKind: "UNIQUE INDEX" | "INDEX",
  indexName: string,
  tableName: string,
  columnList: string,
  whereSql?: string,
): Promise<void> {
  const where = whereSql !== undefined ? ` WHERE ${whereSql}` : "";
  await asRawClient(db).unsafe(
    `CREATE ${indexKind} IF NOT EXISTS ${quoteTableIdent(indexName)} ON ${quoteTableIdent(tableName)} (${columnList})${where}`,
  );
}
