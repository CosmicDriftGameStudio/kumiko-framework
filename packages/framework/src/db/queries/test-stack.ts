import { extractPgError } from "../pg-error.ts";
import type { AnyDb } from "../query.ts";
import { asRawClient } from "../query.ts";
import { PROJECTION_REBUILD_SCHEMA } from "./shadow-swap.ts";
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
  owner?: string,
): Promise<void> {
  const template =
    templateDbName === undefined ? "" : ` TEMPLATE ${quoteTableIdent(templateDbName)}`;
  const ownerClause = owner === undefined ? "" : ` OWNER ${quoteTableIdent(owner)}`;
  await asRawClient(db).unsafe(
    `CREATE DATABASE ${quoteTableIdent(dbName)}${template}${ownerClause}`,
  );
}

const DUPLICATE_OBJECT = "42710";
const UNIQUE_VIOLATION = "23505";

// Parallel workers race on CREATE ROLE; losing the race means the role exists, which is the goal.
export async function createApplicationRole(
  admin: AnyDb,
  role: string,
  password: string,
): Promise<void> {
  const raw = asRawClient(admin);
  const existing = await raw.unsafe(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [role]);
  // skip: role already created by an earlier run or worker
  if (existing.length > 0) return;
  try {
    await raw.unsafe(
      `CREATE ROLE ${quoteTableIdent(role)} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${quoteLiteral(password)}`,
    );
  } catch (error) {
    const code = extractPgError(error)?.code;
    if (code !== DUPLICATE_OBJECT && code !== UNIQUE_VIOLATION) throw error;
  }
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function transferDatabaseOwnership(
  admin: AnyDb,
  dbName: string,
  owner: string,
): Promise<void> {
  await asRawClient(admin).unsafe(
    `ALTER DATABASE ${quoteTableIdent(dbName)} OWNER TO ${quoteTableIdent(owner)}`,
  );
}

const OWNED_SCHEMA_PUBLIC = "public";
const OWNED_RELATION_KINDS: Readonly<Record<string, string>> = {
  r: "TABLE",
  p: "TABLE",
  S: "SEQUENCE",
  v: "VIEW",
  m: "MATERIALIZED VIEW",
};

// Run on a connection to the database itself. REASSIGN OWNED fails for a bootstrap superuser, so owners move per relation.
// The rebuild schema is included: a persistent database that already rebuilt as superuser would otherwise refuse the
// application role's next rebuild for lack of CREATE on it.
export async function transferPublicSchemaOwnership(db: AnyDb, owner: string): Promise<void> {
  const raw = asRawClient(db);
  const ownedSchemas = [OWNED_SCHEMA_PUBLIC, PROJECTION_REBUILD_SCHEMA];
  const rebuildSchema = await raw.unsafe(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [
    PROJECTION_REBUILD_SCHEMA,
  ]);
  if (rebuildSchema.length > 0) {
    await raw.unsafe(
      `ALTER SCHEMA ${quoteTableIdent(PROJECTION_REBUILD_SCHEMA)} OWNER TO ${quoteTableIdent(owner)}`,
    );
  }
  const relations = await raw.unsafe<{ nspname: string; relname: string; relkind: string }>(
    `SELECT n.nspname, c.relname, c.relkind::text AS relkind
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = ANY($2::text[]) AND c.relkind IN ('r', 'p', 'S', 'v', 'm') AND r.rolname <> $1
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i'))`,
    [owner, ownedSchemas],
  );
  for (const { nspname, relname, relkind } of relations) {
    const kind = OWNED_RELATION_KINDS[relkind];
    if (kind === undefined) continue;
    await raw.unsafe(
      `ALTER ${kind} ${quoteTableIdent(nspname)}.${quoteTableIdent(relname)} OWNER TO ${quoteTableIdent(owner)}`,
    );
  }
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
