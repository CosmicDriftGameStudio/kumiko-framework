// Standalone `kumiko schema apply` for production bundles. Apps bundle a thin
// bin/kumiko.ts that only calls runStandaloneSchemaCli with the app features;
// all orchestration (infrastructure bootstrap, migrations, projection rebuild)
// lives here instead of being repeated as ~100 lines of boilerplate per app.
//
// The Pulumi-migrate-initContainer calls `bun /app/kumiko.js schema apply`;
// kumiko-build discovers the app bin via findRepoRoot() and bundles it.

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  createDbConnection,
  type RowLevelSecurityMode,
  runMigrationsFromDir,
} from "@cosmicdrift/kumiko-framework/db";
import { createRegistry, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { DEFAULT_ROW_LEVEL_SECURITY_MODE } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import {
  queueRebuildsFromMarkers,
  reportPendingRebuildRun,
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
  /** App features (e.g. APP_FEATURES from run-config), composed with the
   * bundled features for the projection rebuild registry. */
  readonly features: readonly FeatureDefinition[];
  /** Default INIT_CWD ?? process.cwd(); migrations live under <appCwd>/kumiko/migrations. */
  readonly appCwd?: string;
  /** Pass appConfig.rowLevelSecurity: on a role the policies bind, migrations and rebuilds only see rows through an "on" connection. Default "on". */
  readonly rowLevelSecurity?: RowLevelSecurityMode;
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
    console.error(
      `\n  ${migrationsDir} is missing — kumiko/migrations/ must be part of the image.\n`,
    );
    return 1;
  }

  const { db, close } = createDbConnection({
    url: dbUrl,
    rowLevelSecurity: opts.rowLevelSecurity ?? DEFAULT_ROW_LEVEL_SECURITY_MODE,
  });
  try {
    // Create infrastructure tables (event store + pipeline state) first; all are
    // tableExists-gated and idempotent: on an existing DB this is a no-op, while
    // on an empty Greenfield DB they create kumiko_events/_consumers/_projections
    // before the app migrations run. Without this, an empty DB (e.g. cashcolt
    // on a fresh CNPG) fails with `relation "kumiko_events" does not exist`.
    console.log("\n  Creating framework infrastructure tables (idempotent)…");
    await createEventsTable(db);
    await createEventConsumerStateTable(db);
    await createProjectionStateTable(db);

    console.log(`  Applying kumiko migrations (${migrationsDir})…`);
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
    // skipped on the next apply. queueRebuildsFromMarkers persists
    // the marker tables BEFORE the rebuild; runPendingRebuilds unconditionally
    // also picks up open entries from earlier, failed runs — not just the
    // ones this run freshly applied.
    const thisRunTables = await queueRebuildsFromMarkers(db, {
      migrationsDir,
      appliedIds: result.applied,
    });
    const registry = createRegistry(composeFeatures([...opts.features], opts));
    const rebuildRun = await runPendingRebuilds(db, registry, { thisRunTables });
    reportPendingRebuildRun(rebuildRun, console.log);

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
    `\n  Unknown command: kumiko ${cmd ?? ""} ${sub ?? ""}\n  The standalone bundle only supports 'kumiko schema apply'.\n`,
  );
  process.exit(1);
}
