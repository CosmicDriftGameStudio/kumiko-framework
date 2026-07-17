// Standalone `kumiko schema apply` für Production-Bundles. Apps bündeln ein
// dünnes bin/kumiko.ts das nur runStandaloneSchemaCli mit den App-Features
// aufruft — die ganze Orchestrierung (Infra-Bootstrap, Migrations,
// Projection-Rebuild) lebt hier statt als ~100-Zeilen-Boilerplate pro App.
//
// Der Pulumi-migrate-initContainer ruft `bun /app/kumiko.js schema apply`;
// kumiko-build entdeckt das App-bin via findRepoRoot() und bündelt es.

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  createDbConnection,
  type DbConnection,
  readRebuildMarker,
  runMigrationsFromDir,
} from "@cosmicdrift/kumiko-framework/db";
import { createRegistry, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { buildProjectionTableIndex } from "@cosmicdrift/kumiko-framework/migrations";
import {
  createEventConsumerStateTable,
  createProjectionStateTable,
  rebuildProjection,
} from "@cosmicdrift/kumiko-framework/pipeline";
import {
  type ComposeFeaturesOptions,
  composeFeatures,
} from "@cosmicdrift/kumiko-server-runtime/compose-features";

export type SchemaApplyOptions = ComposeFeaturesOptions & {
  /** App-Features (z.B. APP_FEATURES aus run-config) — composed mit den
   *  bundled-Features für den Projection-Rebuild-Registry. */
  readonly features: readonly FeatureDefinition[];
  /** Default INIT_CWD ?? process.cwd(); Migrations unter <appCwd>/kumiko/migrations. */
  readonly appCwd?: string;
};

export async function runSchemaApply(opts: SchemaApplyOptions): Promise<number> {
  const dbUrl = process.env["DATABASE_URL"];
  if (!dbUrl) {
    console.error("\n  DATABASE_URL not set.\n");
    return 1;
  }

  const appCwd = opts.appCwd ?? process.env["INIT_CWD"] ?? process.cwd();
  const migrationsDir = join(appCwd, "kumiko/migrations");
  if (!existsSync(migrationsDir)) {
    console.error(`\n  ${migrationsDir} fehlt — kumiko/migrations/ muss im Image liegen.\n`);
    return 1;
  }

  const { db, close } = createDbConnection(dbUrl);
  try {
    // Infra-Tabellen (event-store + pipeline-state) zuerst, alle
    // tableExists-gated idempotent: auf einer Bestands-DB no-op, auf einer
    // leeren Greenfield-DB legen sie kumiko_events/_consumers/_projections an
    // bevor die App-Migrations dagegen laufen. Ohne das bricht eine leere DB
    // (z.B. cashcolt auf frischem CNPG) an `relation "kumiko_events" does not exist`.
    console.log("\n  Lege Framework-Infra-Tabellen an (idempotent)…");
    await createEventsTable(db);
    await createEventConsumerStateTable(db);
    await createProjectionStateTable(db);

    console.log(`  Wende kumiko-Migrations an (${migrationsDir})…`);
    const result = await runMigrationsFromDir(db, migrationsDir);
    if (result.applied.length === 0) {
      console.log(`\n  ✓ All ${result.skipped.length} migrations already applied.\n`);
    } else {
      console.log(`\n  ✓ Applied ${result.applied.length}:`);
      for (const id of result.applied) console.log(`    + ${id}`);
      if (result.skipped.length > 0) console.log(`  (${result.skipped.length} already applied)`);
      console.log("");
    }

    // Projection-Rebuild für Tabellen die in frisch applizierten Migrations
    // geändert wurden (Marker NNNN_<name>.rebuild.json von `schema generate`).
    // Ohne das blieben read_*-Projektionen nach einem Schema-Change stale.
    const changedTables = new Set<string>();
    for (const id of result.applied) {
      for (const table of readRebuildMarker(migrationsDir, id)) changedTables.add(table);
    }
    if (changedTables.size > 0) {
      await rebuildAffectedProjections(db, [...changedTables], opts);
    }

    return 0;
  } catch (e) {
    console.error(`\n  ✗ ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    return 1;
  } finally {
    await close();
  }
}

async function rebuildAffectedProjections(
  db: DbConnection,
  changedTables: readonly string[],
  opts: SchemaApplyOptions,
): Promise<void> {
  const registry = createRegistry(composeFeatures([...opts.features], opts));
  const tableToProjection = buildProjectionTableIndex(registry);

  const projections = new Set<string>();
  for (const table of changedTables) {
    const name = tableToProjection.get(table);
    if (name) {
      projections.add(name);
    } else {
      // 522/3: a table in a .rebuild.json marker that no longer matches any
      // registered projection would otherwise rebuild nothing and exit 0 —
      // indistinguishable from "nothing needed a rebuild".
      console.warn(
        `  ⚠ Table "${table}" is in a rebuild marker but matches no registered projection — skipped.`,
      );
    }
  }
  if (projections.size === 0) return;

  console.log(`  Rebuild ${projections.size} Projection(s)…`);
  for (const name of projections) {
    const r = await rebuildProjection(name, { db, registry });
    console.log(`    ↻ ${name} (${r.eventsProcessed} events, ${r.durationMs}ms)`);
  }
  console.log("");
}

export async function runStandaloneSchemaCli(opts: SchemaApplyOptions): Promise<never> {
  const cmd = Bun.argv[2];
  const sub = Bun.argv[3];

  if (cmd === "schema" && sub === "apply") {
    process.exit(await runSchemaApply(opts));
  }

  console.error(
    `\n  Unbekannt: kumiko ${cmd ?? ""} ${sub ?? ""}\n  Nur 'kumiko schema apply' im Standalone-Bundle.\n`,
  );
  process.exit(1);
}
