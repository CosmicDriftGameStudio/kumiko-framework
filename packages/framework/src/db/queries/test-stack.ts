import type { AnyDb } from "../query";
import { asRawClient } from "../query";
import { quoteTableIdent } from "./table-ops";

// Re-exported for back-compat — the generic DDL helpers moved to ./ddl so
// the prod-boot path (stack/table-helpers.ts, pipeline/event-consumer-state.ts)
// doesn't import from a module named for test-only concerns.
export { alterTableAddColumn, createIndexIfNotExists, executeDdlStatement } from "./ddl";

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
