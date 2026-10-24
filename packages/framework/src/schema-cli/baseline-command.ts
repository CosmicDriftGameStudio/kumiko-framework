import { createDbConnection } from "../db/index.ts";
import { baselineMigrations, loadMigrationsFromDir } from "../db/migrate-runner.ts";

import {
  describeThrown,
  migrationsDirExistsOrReport,
  readDatabaseUrlOrReport,
  type SchemaCliContext,
} from "./shared.ts";

export async function runBaselineCommand(ctx: SchemaCliContext): Promise<number> {
  const { out, migrationsDir } = ctx;
  // Adopt an existing DB: mark all checked-in migrations as applied WITHOUT
  // running their SQL (prod tables already exist — cutover from the legacy
  // drizzle system). Afterwards the boot-gate is drift-free.
  const dbUrl = readDatabaseUrlOrReport(out);
  if (dbUrl === undefined) return 1;
  if (!migrationsDirExistsOrReport(ctx)) return 1;
  const { db, close } = createDbConnection({
    url: dbUrl,
    maxConnections: 1,
    rowLevelSecurity: "off", // journal-only tool: touches no tenant rows
  });
  try {
    const result = await baselineMigrations(db, loadMigrationsFromDir(migrationsDir));
    out.log("");
    out.log(`  ✓ Marked ${result.marked.length} migration(s) as applied (no SQL run):`);
    for (const id of result.marked) out.log(`    + ${id}`);
    if (result.alreadyTracked.length > 0) {
      out.log(`  (${result.alreadyTracked.length} already tracked)`);
    }
    out.log("");
    return 0;
  } catch (e) {
    out.err(`  ✗ ${describeThrown(e)}`);
    return 1;
  } finally {
    await close();
  }
}
