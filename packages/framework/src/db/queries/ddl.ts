import type { DbConnection } from "../connection.ts";
import type { EntityTableMeta } from "../entity-table-meta.ts";
import type { AnyDb } from "../query.ts";
import { asRawClient, transaction } from "../query.ts";
import { renderTableRowLevelSecurityDdl } from "../render-rls-ddl.ts";
import { quoteIdent } from "../sql-identifier.ts";
import { quoteTableIdent } from "./table-ops.ts";

// Generic DDL helpers used on the prod-boot path (db/table-push.ts's
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
  // multi-instance boot path) opt in explicitly.
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

export async function applyTableRowLevelSecurity(
  db: DbConnection,
  meta: EntityTableMeta,
): Promise<void> {
  const statements = renderTableRowLevelSecurityDdl(meta);
  // skip: no tenant_id column, nothing to enforce
  if (statements.length === 0) return;
  await transaction(db, async (tx) => {
    // Self-conflicting lock: parallel pushes queue up instead of failing CREATE POLICY with duplicate_object.
    await tx.unsafe(`LOCK TABLE ${quoteIdent(meta.tableName)} IN SHARE ROW EXCLUSIVE MODE`);
    for (const statement of statements) await tx.unsafe(statement);
  });
}
