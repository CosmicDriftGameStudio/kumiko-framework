import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  createDbConnection,
  type DbConnection,
  fetchAppliedMigrations,
  findCommentedDropTables,
  isRetiredFrameworkTable,
  loadMigrationsFromDir,
  readMigrationSqlTexts,
  tableExists,
} from "../db/index.ts";
import {
  describeThrown,
  loadPreviousSnapshot,
  readDatabaseUrlOrReport,
  type SchemaCliContext,
  type SchemaCliOut,
  SNAPSHOT_FILENAME,
} from "./shared.ts";

// A table that a migration only drops as a commented DESTRUCTIVE marker and
// that the snapshot no longer has is gone on paper but still in the live DB.
async function reportLeftoverDroppedTables(
  db: DbConnection,
  migrationsDir: string,
  out: SchemaCliOut,
): Promise<void> {
  const snapshot = loadPreviousSnapshot(join(migrationsDir, SNAPSHOT_FILENAME));
  const leftovers: string[] = [];
  for (const tableName of findCommentedDropTables(readMigrationSqlTexts(migrationsDir), snapshot)) {
    if (await tableExists(db, tableName)) leftovers.push(tableName);
  }
  // skip: nothing left over, nothing to report
  if (leftovers.length === 0) return;
  out.log("  Tables dropped only as a commented DESTRUCTIVE marker but still in the database:");
  for (const tableName of leftovers) {
    out.log(
      isRetiredFrameworkTable(tableName)
        ? `    ! ${tableName} — retired framework table: the next \`schema generate <name>\` creates the drop`
        : `    ! ${tableName} — app table: after a backup, write a new migration with the drop`,
    );
  }
  out.log("");
}

async function fetchAppliedMigrationIds(db: DbConnection): Promise<ReadonlySet<string>> {
  // On a fresh database where `kumiko schema apply` has never run, the tracking table is
  // absent, which means "nothing applied". Connection and permission errors must not
  // be swallowed (false pending results would hide the problem) — tableExists checks
  // only for existence, while all other errors propagate.
  const trackingExists = await tableExists(db, "_kumiko_migrations");
  return trackingExists
    ? new Set((await fetchAppliedMigrations(db)).map((a) => a.id))
    : new Set<string>();
}

export async function runStatusCommand(ctx: SchemaCliContext): Promise<number> {
  const { out, migrationsDir } = ctx;
  const dbUrl = readDatabaseUrlOrReport(out);
  if (dbUrl === undefined) return 1;
  if (!existsSync(migrationsDir)) {
    out.log("  No kumiko/migrations/ — the app is still on the legacy drizzle path.");
    return 0;
  }
  const local = loadMigrationsFromDir(migrationsDir);
  const { db, close } = createDbConnection({
    url: dbUrl,
    maxConnections: 1,
    rowLevelSecurity: "off", // journal-only tool: touches no tenant rows
  });
  try {
    const applied = await fetchAppliedMigrationIds(db);
    out.log("");
    out.log(`  ${local.length} migrations in ${migrationsDir}:`);
    for (const m of local) out.log(`    ${applied.has(m.id) ? "✓" : " "} ${m.id}`);
    const pending = local.filter((m) => !applied.has(m.id)).length;
    out.log("");
    out.log(`  ${applied.size} applied, ${pending} pending.`);
    out.log("");
    await reportLeftoverDroppedTables(db, migrationsDir, out);
    return pending === 0 ? 0 : 1;
  } catch (e) {
    // Message only, never dbUrl: it can carry the password.
    out.err(`  ✗ schema status failed: ${describeThrown(e)}`);
    out.err(
      '  Check that DATABASE_URL is reachable and the database exists (the scaffold\'s docker-compose creates "app").',
    );
    return 1;
  } finally {
    try {
      await close();
    } catch {
      // The connection already failed and was reported above; a failing close must not throw again.
    }
  }
}
