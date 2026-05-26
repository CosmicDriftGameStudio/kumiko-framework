// `kumiko schema` — neuer Migration-Pfad ohne drizzle-kit.
//
// Setzt das NO-MAGIC-ON-DATA-Prinzip um (siehe
// kumiko-platform/docs/plans/pending/drizzle-replacement.md):
//
//   1. **generate <name>** — sammelt App-Schema (Convention:
//      kumiko/schema.ts mit `export const ENTITY_METAS`), berechnet Diff
//      gegen letzten Snapshot, schreibt NEUE `kumiko/migrations/NNNN_<name>.sql`
//      + Snapshot. SQL-File wird committed + im PR reviewed + ggf. von
//      App-Author hand-editiert (partial-Indexes, BRIN, performance-tuning).
//   2. **apply** — runMigrationsFromDir(kumiko/migrations) — appliziert
//      checked-in SQL-Files mit _kumiko_migrations Checksum-Tracking. NIE
//      Runtime-Auto-Generation. NIE Apply-on-App-Boot.
//   3. **status** — listet applied vs pending Migrations.
//
// Parallel zum legacy `kumiko migrate` (drizzle-kit-basiert). Apps stellen
// um wenn sie wollen — kumiko/schema.ts + kumiko/migrations/ anlegen, dann
// schema-Pfad nutzen.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { defineCommand } from "./registry";

const SNAPSHOT_FILENAME = ".snapshot.json";

async function loadEntityMetasFromApp(schemaFile: string) {
  // bun importiert TS direkt — kein eigenes spawn nötig.
  const mod = (await import(schemaFile)) as { ENTITY_METAS?: unknown };
  if (!Array.isArray(mod.ENTITY_METAS)) {
    throw new Error(
      `Schema file ${schemaFile} muss \`export const ENTITY_METAS: EntityTableMeta[]\` haben.`,
    );
  }
  return mod.ENTITY_METAS as Parameters<
    typeof import("@cosmicdrift/kumiko-framework/db").renderTablesDdl
  >[0];
}

async function nextSequenceNumber(migrationsDir: string): Promise<number> {
  const { readdirSync } = await import("node:fs");
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

export const schemaCommand = defineCommand({
  id: "schema",
  label: "schema",
  description:
    "DB-schema migrations (NO-MAGIC-ON-DATA pipeline) — generate | apply | status",
  help: [
    "Subcommands:",
    "  generate <name>   Sammelt App-Schema (kumiko/schema.ts → ENTITY_METAS),",
    "                    berechnet Diff gegen letzten Snapshot, schreibt NEUES",
    "                    kumiko/migrations/NNNN_<name>.sql + .snapshot.json.",
    "                    SQL-File committen + im PR reviewen — App-Author darf",
    "                    hand-editieren (partial-indexes, BRIN, performance-tuning).",
    "  apply             Applied alle pending SQL-Files aus kumiko/migrations/",
    "                    mit Checksum-Tracking. Idempotent. Deploy-Step-only,",
    "                    NIE als App-Boot-Hook. Liest NUR checked-in artifacts.",
    "  status            Listet applied vs pending Migrations gegen DATABASE_URL.",
  ].join("\n"),
  category: "ops",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    const sub = ctx.argv[0];
    const appCwd = process.env["INIT_CWD"] ?? ctx.cwd;
    const schemaFile = resolvePath(appCwd, "kumiko/schema.ts");
    const migrationsDir = resolvePath(appCwd, "kumiko/migrations");

    switch (sub) {
      case "generate": {
        const name = ctx.argv[1];
        if (!name) {
          ctx.out.err("  Usage: kumiko schema generate <name>");
          return 1;
        }
        if (!existsSync(schemaFile)) {
          ctx.out.err(`  ${schemaFile} fehlt.`);
          ctx.out.err("  App-Convention: kumiko/schema.ts mit");
          ctx.out.err("    export const ENTITY_METAS: EntityTableMeta[] = [...]");
          return 1;
        }
        const { generateMigration, loadSnapshotJson, writeSnapshotJson } = await import("@cosmicdrift/kumiko-framework/db");
        const metas = await loadEntityMetasFromApp(schemaFile);

        const snapshotPath = join(migrationsDir, SNAPSHOT_FILENAME);
        const prevSnapshot = existsSync(snapshotPath) ? loadSnapshotJson(snapshotPath) : null;
        const sequenceNumber = await nextSequenceNumber(migrationsDir);

        const result = generateMigration({
          metas,
          prevSnapshot,
          name,
          sequenceNumber,
        });

        const isEmpty =
          result.diff.newTables.length === 0 &&
          result.diff.changedTables.length === 0 &&
          result.diff.droppedTables.length === 0;
        if (isEmpty) {
          ctx.out.log("  No schema changes detected — kein neues Migration-File geschrieben.");
          return 0;
        }

        if (!existsSync(migrationsDir)) mkdirSync(migrationsDir, { recursive: true });
        const sqlPath = join(migrationsDir, result.filename);
        writeFileSync(sqlPath, result.sqlContent);
        writeSnapshotJson(snapshotPath, result.snapshot);

        ctx.out.log("");
        ctx.out.log(`  ✓ ${result.filename}`);
        ctx.out.log(
          `    new tables: ${result.diff.newTables.length}, changed: ${result.diff.changedTables.length}, dropped: ${result.diff.droppedTables.length}`,
        );
        ctx.out.log("");
        ctx.out.log("  Review + ggf. hand-edit + git add + commit. Apply via:");
        ctx.out.log("    kumiko schema apply");
        ctx.out.log("");
        return 0;
      }

      case "apply": {
        const dbUrl = process.env["DATABASE_URL"];
        if (!dbUrl) {
          ctx.out.err("  DATABASE_URL not set.");
          return 1;
        }
        if (!existsSync(migrationsDir)) {
          ctx.out.err(`  ${migrationsDir} fehlt — erst kumiko schema generate <name> laufen lassen.`);
          return 1;
        }
        const { createDbConnection } = await import("@cosmicdrift/kumiko-framework/db");
        const { runMigrationsFromDir } = await import("@cosmicdrift/kumiko-framework/db");
        const { db, close } = createDbConnection(dbUrl);
        try {
          const result = await runMigrationsFromDir(db, migrationsDir);
          ctx.out.log("");
          if (result.applied.length === 0) {
            ctx.out.log(`  ✓ All ${result.skipped.length} migrations already applied.`);
          } else {
            ctx.out.log(`  ✓ Applied ${result.applied.length}:`);
            for (const id of result.applied) ctx.out.log(`    + ${id}`);
            if (result.skipped.length > 0) ctx.out.log(`  (${result.skipped.length} already applied)`);
          }
          ctx.out.log("");
          return 0;
        } catch (e) {
          ctx.out.err("");
          ctx.out.err(`  ✗ ${e instanceof Error ? e.message : String(e)}`);
          ctx.out.err("");
          return 1;
        } finally {
          await close();
        }
      }

      case "status": {
        const dbUrl = process.env["DATABASE_URL"];
        if (!dbUrl) {
          ctx.out.err("  DATABASE_URL not set.");
          return 1;
        }
        if (!existsSync(migrationsDir)) {
          ctx.out.log("  Kein kumiko/migrations/ — App ist noch auf dem alten drizzle-Pfad.");
          return 0;
        }
        const { createDbConnection, fetchAppliedMigrations, loadMigrationsFromDir } = await import(
          "@cosmicdrift/kumiko-framework/db"
        );
        const local = loadMigrationsFromDir(migrationsDir);
        const { db, close } = createDbConnection(dbUrl);
        try {
          // Frag _kumiko_migrations ab (falls existiert). fetchAppliedMigrations
          // wirft wenn die tracking-table noch nicht da ist → leeres Set.
          let applied: Set<string>;
          try {
            applied = new Set((await fetchAppliedMigrations(db)).map((a) => a.id));
          } catch {
            applied = new Set();
          }
          ctx.out.log("");
          ctx.out.log(`  ${local.length} migrations in ${migrationsDir}:`);
          for (const m of local) {
            const mark = applied.has(m.id) ? "✓" : " ";
            ctx.out.log(`    ${mark} ${m.id}`);
          }
          const pending = local.filter((m) => !applied.has(m.id)).length;
          ctx.out.log("");
          ctx.out.log(`  ${applied.size} applied, ${pending} pending.`);
          ctx.out.log("");
          return pending === 0 ? 0 : 0;
        } finally {
          await close();
        }
      }

      case "baseline": {
        // Adoptiert eine bestehende DB: markiert alle checked-in Migrations als
        // applied OHNE ihr SQL zu runnen (Prod-Tabellen existieren schon —
        // Cutover vom legacy drizzle-System). Danach ist der Boot-Gate drift-frei.
        const dbUrl = process.env["DATABASE_URL"];
        if (!dbUrl) {
          ctx.out.err("  DATABASE_URL not set.");
          return 1;
        }
        if (!existsSync(migrationsDir)) {
          ctx.out.err(`  ${migrationsDir} fehlt — erst kumiko schema generate <name>.`);
          return 1;
        }
        const { baselineMigrations, createDbConnection, loadMigrationsFromDir } = await import(
          "@cosmicdrift/kumiko-framework/db"
        );
        const local = loadMigrationsFromDir(migrationsDir);
        const { db, close } = createDbConnection(dbUrl);
        try {
          const result = await baselineMigrations(db, local);
          ctx.out.log("");
          ctx.out.log(`  ✓ Marked ${result.marked.length} migration(s) as applied (no SQL run):`);
          for (const id of result.marked) ctx.out.log(`    + ${id}`);
          if (result.alreadyTracked.length > 0) {
            ctx.out.log(`  (${result.alreadyTracked.length} already tracked)`);
          }
          ctx.out.log("");
          return 0;
        } catch (e) {
          ctx.out.err(`  ✗ ${e instanceof Error ? e.message : String(e)}`);
          return 1;
        } finally {
          await close();
        }
      }

      default: {
        ctx.out.log("");
        ctx.out.log("  Subcommands:");
        ctx.out.log("    generate <name>   Schreibe neue Migration aus EntityTableMeta-Diff");
        ctx.out.log("    apply             Applied pending checked-in SQL-Files");
        ctx.out.log("    baseline          Markiere checked-in Migrations als applied (kein SQL-Run)");
        ctx.out.log("    status            Liste applied vs pending");
        ctx.out.log("");
        return 0;
      }
    }
  },
});
