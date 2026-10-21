import type { AnyDb } from "../query.ts";
import { asRawClient } from "../query.ts";
import { quoteTableIdent } from "./table-ops.ts";

// Re-exported for back-compat — the generic DDL helpers moved to ./ddl so
// the prod-boot path (db/table-push.ts, pipeline/event-consumer-state.ts)
// doesn't import from a module named for test-only concerns.
export { alterTableAddColumn, createIndexIfNotExists, executeDdlStatement } from "./ddl.ts";

export async function truncateTablesRestartIdentity(
  db: AnyDb,
  tableNames: readonly string[],
): Promise<void> {
  const quoted = tableNames.map((name) => quoteTableIdent(name)).join(", ");
  await asRawClient(db).unsafe(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`);
}

export async function databaseExists(db: AnyDb, dbName: string): Promise<boolean> {
  const rows = await asRawClient(db).unsafe<{ exists?: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists`,
    [dbName],
  );
  return rows[0]?.exists === true;
}

export async function createDatabase(
  db: AnyDb,
  dbName: string,
  templateDbName?: string,
): Promise<void> {
  const template =
    templateDbName === undefined ? "" : ` TEMPLATE ${quoteTableIdent(templateDbName)}`;
  await asRawClient(db).unsafe(`CREATE DATABASE ${quoteTableIdent(dbName)}${template}`);
}

export async function renameDatabase(db: AnyDb, fromName: string, toName: string): Promise<void> {
  await asRawClient(db).unsafe(
    `ALTER DATABASE ${quoteTableIdent(fromName)} RENAME TO ${quoteTableIdent(toName)}`,
  );
}

export async function listDatabaseNamesWithPrefix(
  db: AnyDb,
  prefix: string,
): Promise<readonly string[]> {
  const rows = await asRawClient(db).unsafe<{ datname: string }>(
    `SELECT datname FROM pg_database WHERE starts_with(datname, $1) ORDER BY datname`,
    [prefix],
  );
  return rows.map((row) => row.datname);
}

// Session-scoped: CREATE DATABASE cannot run inside a transaction, so the
// xact-scoped variant cannot guard it. Released when the session closes.
export async function acquireSessionAdvisoryLock(db: AnyDb, key: string): Promise<void> {
  await asRawClient(db).unsafe(`SELECT pg_advisory_lock(hashtext($1))`, [key]);
}

export async function dropDatabaseIfExists(db: AnyDb, dbName: string): Promise<void> {
  await asRawClient(db).unsafe(`DROP DATABASE IF EXISTS ${quoteTableIdent(dbName)}`);
}
