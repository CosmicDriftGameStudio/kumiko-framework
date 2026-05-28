// Shared core for the schema-migration CLI (generate | apply | baseline | status).
//
// Used by BOTH the dev `kumiko schema` command (bin/commands/schema.ts) and the
// shipped `kumiko-schema` bin (dev-server) — so apps run migrations without the
// full dev-CLI registry (which eager-loads ts-morph-heavy dev commands).
//
// NO-MAGIC-ON-DATA: reads only checked-in artifacts (kumiko/schema.ts →
// ENTITY_METAS, kumiko/migrations/*.sql). Never auto-generates at runtime,
// never applies on app-boot — apply/baseline are explicit deploy-steps.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import {
  baselineMigrations,
  createDbConnection,
  fetchAppliedMigrations,
  generateMigration,
  loadMigrationsFromDir,
  loadSnapshotJson,
  rebuildTablesFromDiff,
  type renderTablesDdl,
  runMigrationsFromDir,
  tableExists,
  writeRebuildMarker,
  writeSnapshotJson,
} from "./db";

export type SchemaCliOut = {
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
};

const SNAPSHOT_FILENAME = ".snapshot.json";

async function loadEntityMetasFromApp(
  schemaFile: string,
): Promise<Parameters<typeof renderTablesDdl>[0]> {
  // bun imports TS directly — no spawn needed.
  const mod = (await import(schemaFile)) as { ENTITY_METAS?: unknown };
  if (!Array.isArray(mod.ENTITY_METAS)) {
    throw new Error(
      `Schema file ${schemaFile} muss \`export const ENTITY_METAS: EntityTableMeta[]\` haben.`,
    );
  }
  return mod.ENTITY_METAS as Parameters<typeof renderTablesDdl>[0];
}

function nextSequenceNumber(migrationsDir: string): number {
  if (!existsSync(migrationsDir)) return 1;
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  let max = 0;
  for (const f of files) {
    const m = f.match(/^(\d+)_/);
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

/**
 * Runs a schema-CLI subcommand. `appCwd` is the app workspace root (where
 * `kumiko/schema.ts` + `kumiko/migrations/` live). Returns a process exit code.
 */
export async function runSchemaCli(
  argv: readonly string[],
  appCwd: string,
  out: SchemaCliOut,
): Promise<number> {
  const sub = argv[0];
  const schemaFile = resolvePath(appCwd, "kumiko/schema.ts");
  const migrationsDir = resolvePath(appCwd, "kumiko/migrations");

  switch (sub) {
    case "generate": {
      const name = argv[1];
      if (!name) {
        out.err("  Usage: kumiko-schema generate <name>");
        return 1;
      }
      if (!existsSync(schemaFile)) {
        out.err(`  ${schemaFile} fehlt.`);
        out.err("  App-Convention: kumiko/schema.ts mit");
        out.err("    export const ENTITY_METAS: EntityTableMeta[] = [...]");
        return 1;
      }
      const metas = await loadEntityMetasFromApp(schemaFile);
      const snapshotPath = join(migrationsDir, SNAPSHOT_FILENAME);
      const prevSnapshot = existsSync(snapshotPath) ? loadSnapshotJson(snapshotPath) : null;
      const result = generateMigration({
        metas,
        prevSnapshot,
        name,
        sequenceNumber: nextSequenceNumber(migrationsDir),
      });

      const isEmpty =
        result.diff.newTables.length === 0 &&
        result.diff.changedTables.length === 0 &&
        result.diff.droppedTables.length === 0;
      if (isEmpty) {
        out.log("  No schema changes detected — kein neues Migration-File geschrieben.");
        return 0;
      }

      if (!existsSync(migrationsDir)) mkdirSync(migrationsDir, { recursive: true });
      writeFileSync(join(migrationsDir, result.filename), result.sqlContent);
      writeSnapshotJson(snapshotPath, result.snapshot);

      // Rebuild-Marker nur für inkrementelle Migrationen — die Init-Migration
      // (prevSnapshot===null) legt nur Tabellen an, es gibt keine historischen
      // Events zum Replayen.
      const rebuildTables = prevSnapshot === null ? [] : rebuildTablesFromDiff(result.diff);
      writeRebuildMarker(migrationsDir, result.filename, rebuildTables);

      out.log("");
      out.log(`  ✓ ${result.filename}`);
      out.log(
        `    new tables: ${result.diff.newTables.length}, changed: ${result.diff.changedTables.length}, dropped: ${result.diff.droppedTables.length}`,
      );
      if (rebuildTables.length > 0) {
        out.log(
          `    rebuild-marker: ${result.filename.replace(/\.sql$/, ".rebuild.json")} (${rebuildTables.length} table(s))`,
        );
      }
      out.log("");
      out.log("  Review + ggf. hand-edit + git add + commit. Apply via: kumiko-schema apply");
      out.log("");
      return 0;
    }

    case "apply": {
      const dbUrl = process.env["DATABASE_URL"];
      if (!dbUrl) {
        out.err("  DATABASE_URL not set.");
        return 1;
      }
      if (!existsSync(migrationsDir)) {
        out.err(`  ${migrationsDir} fehlt — erst kumiko-schema generate <name>.`);
        return 1;
      }
      const { db, close } = createDbConnection(dbUrl);
      try {
        const result = await runMigrationsFromDir(db, migrationsDir);
        out.log("");
        if (result.applied.length === 0) {
          out.log(`  ✓ All ${result.skipped.length} migrations already applied.`);
        } else {
          out.log(`  ✓ Applied ${result.applied.length}:`);
          for (const id of result.applied) out.log(`    + ${id}`);
          if (result.skipped.length > 0) out.log(`  (${result.skipped.length} already applied)`);
        }
        out.log("");
        return 0;
      } catch (e) {
        out.err("");
        out.err(`  ✗ ${e instanceof Error ? e.message : String(e)}`);
        out.err("");
        return 1;
      } finally {
        await close();
      }
    }

    case "baseline": {
      // Adopt an existing DB: mark all checked-in migrations as applied WITHOUT
      // running their SQL (prod tables already exist — cutover from the legacy
      // drizzle system). Afterwards the boot-gate is drift-free.
      const dbUrl = process.env["DATABASE_URL"];
      if (!dbUrl) {
        out.err("  DATABASE_URL not set.");
        return 1;
      }
      if (!existsSync(migrationsDir)) {
        out.err(`  ${migrationsDir} fehlt — erst kumiko-schema generate <name>.`);
        return 1;
      }
      const { db, close } = createDbConnection(dbUrl);
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
        out.err(`  ✗ ${e instanceof Error ? e.message : String(e)}`);
        return 1;
      } finally {
        await close();
      }
    }

    case "status": {
      const dbUrl = process.env["DATABASE_URL"];
      if (!dbUrl) {
        out.err("  DATABASE_URL not set.");
        return 1;
      }
      if (!existsSync(migrationsDir)) {
        out.log("  Kein kumiko/migrations/ — App ist noch auf dem alten drizzle-Pfad.");
        return 0;
      }
      const local = loadMigrationsFromDir(migrationsDir);
      const { db, close } = createDbConnection(dbUrl);
      try {
        // Frische DB ohne je gelaufenes `kumiko schema apply` → tracking-table
        // fehlt = "nichts applied". Connection-/Permission-Fehler dagegen
        // sollen NICHT geschluckt werden (False-pending verschleiert das Problem) —
        // tableExists prüft gezielt nur Existenz, alles andere propagiert.
        const trackingExists = await tableExists(db, "_kumiko_migrations");
        const applied = trackingExists
          ? new Set((await fetchAppliedMigrations(db)).map((a) => a.id))
          : new Set<string>();
        out.log("");
        out.log(`  ${local.length} migrations in ${migrationsDir}:`);
        for (const m of local) out.log(`    ${applied.has(m.id) ? "✓" : " "} ${m.id}`);
        const pending = local.filter((m) => !applied.has(m.id)).length;
        out.log("");
        out.log(`  ${applied.size} applied, ${pending} pending.`);
        out.log("");
        return 0;
      } finally {
        await close();
      }
    }

    default: {
      out.log("");
      out.log("  Subcommands:");
      out.log("    generate <name>   Schreibe neue Migration aus EntityTableMeta-Diff");
      out.log("    apply             Applied pending checked-in SQL-Files");
      out.log("    baseline          Markiere checked-in Migrations als applied (kein SQL-Run)");
      out.log("    status            Liste applied vs pending");
      out.log("");
      return 0;
    }
  }
}
