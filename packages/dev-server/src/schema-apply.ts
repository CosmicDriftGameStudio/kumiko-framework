// Standalone `kumiko schema apply` für Production-Bundles. Apps bündeln ein
// dünnes bin/kumiko.ts das nur runStandaloneSchemaCli mit den App-Features
// aufruft — die ganze Orchestrierung (Infra-Bootstrap, Migrations,
// Projection-Rebuild) lebt hier statt als ~100-Zeilen-Boilerplate pro App.
//
// Der Pulumi-migrate-initContainer ruft `bun /app/kumiko.js schema apply`;
// kumiko-build entdeckt das App-bin via findRepoRoot() und bündelt es.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createDbConnection, runMigrationsFromDir } from "@cosmicdrift/kumiko-framework/db";
import { createRegistry, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  queueRebuildsFromMarkers,
  runPendingRebuilds,
} from "@cosmicdrift/kumiko-framework/migrations";
import {
  createEventConsumerStateTable,
  createProjectionStateTable,
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

    // Projection rebuild: persistent queue instead of "only this run's
    // result.applied" — otherwise a failed rebuild stays silently stuck
    // forever, since the migration is already tracked applied and gets
    // skipped on the next apply (#2464). queueRebuildsFromMarkers persists
    // the marker tables BEFORE the rebuild; runPendingRebuilds unconditionally
    // also picks up open entries from earlier, failed runs — not just the
    // ones this run freshly applied.
    const thisRunTables = await queueRebuildsFromMarkers(db, {
      migrationsDir,
      appliedIds: result.applied,
    });
    const registry = createRegistry(composeFeatures([...opts.features], opts));
    const rebuildRun = await runPendingRebuilds(db, registry, { thisRunTables });
    if (rebuildRun.rebuilt.length > 0) {
      console.log(`  Rebuild ${rebuildRun.rebuilt.length} Projection(s)…`);
      for (const r of rebuildRun.rebuilt) {
        console.log(`    ↻ ${r.projection} (${r.eventsProcessed} events)`);
      }
      console.log("");
    }
    if (rebuildRun.failed.length > 0) {
      throw new Error(
        `Projection rebuild failed for: ${rebuildRun.failed
          .map((f) => `${f.projection} (${f.error})`)
          .join(
            "; ",
          )}. Table(s) stay queued in kumiko_pending_rebuilds — retried on the next apply.`,
      );
    }

    return 0;
  } catch (e) {
    console.error(`\n  ✗ ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    return 1;
  } finally {
    await close();
  }
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
