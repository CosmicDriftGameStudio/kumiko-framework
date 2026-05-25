import type { AnyDb } from "../query";
import { asRawClient } from "../query";
import { quoteTableIdent } from "./table-ops";

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
): Promise<void> {
  await asRawClient(db).unsafe(
    `ALTER TABLE ${quoteTableIdent(tableName)} ADD COLUMN ${quoteTableIdent(columnName)} ${columnType}${defaultClause}${notNull}`,
  );
}

export async function createIndexIfNotExists(
  db: AnyDb,
  indexKind: "UNIQUE INDEX" | "INDEX",
  indexName: string,
  tableName: string,
  columnList: string,
): Promise<void> {
  await asRawClient(db).unsafe(
    `CREATE ${indexKind} IF NOT EXISTS ${quoteTableIdent(indexName)} ON ${quoteTableIdent(tableName)} (${columnList})`,
  );
}

export async function truncateTablesRestartIdentity(
  db: AnyDb,
  tableNames: readonly string[],
): Promise<void> {
  const quoted = tableNames.map((name) => quoteTableIdent(name)).join(", ");
  await asRawClient(db).unsafe(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`);
}

export async function databaseExists(db: AnyDb, dbName: string): Promise<boolean> {
  const rows = (await asRawClient(db).unsafe(
    `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists`,
    [dbName],
  )) as readonly { exists?: boolean }[];
  return rows[0]?.exists === true;
}

export async function createDatabase(db: AnyDb, dbName: string): Promise<void> {
  await asRawClient(db).unsafe(`CREATE DATABASE ${quoteTableIdent(dbName)}`);
}

export async function dropDatabaseIfExists(db: AnyDb, dbName: string): Promise<void> {
  await asRawClient(db).unsafe(`DROP DATABASE IF EXISTS ${quoteTableIdent(dbName)}`);
}
