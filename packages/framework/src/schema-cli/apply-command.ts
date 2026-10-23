import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  type KmsWiring,
  resolveKmsWiringAsync,
} from "../crypto/index.ts";
import { createDbConnection, type DbConnection, runMigrationsFromDir } from "../db/index.ts";
import { createRegistry } from "../engine/registry.ts";
import type { FeatureDefinition } from "../engine/types/feature.ts";
import { createEventsTable } from "../event-store/index.ts";
import {
  queueRebuildsFromMarkers,
  reportPendingRebuildRun,
  runPendingRebuilds,
} from "../migrations/index.ts";
import { createEventConsumerStateTable, createProjectionStateTable } from "../pipeline/index.ts";
import {
  loadRowLevelSecurityModeOrReport,
  migrationsDirExistsOrReport,
  readDatabaseUrlOrReport,
  type SchemaCliContext,
  type SchemaCliOut,
} from "./shared.ts";

type MigrationRunResult = Awaited<ReturnType<typeof runMigrationsFromDir>>;

async function ensureFrameworkInfrastructureTables(db: DbConnection): Promise<void> {
  // Framework infrastructure tables (event store + pipeline state) are not captured by
  // `generate`, which handles only entity read tables. Existing databases have them
  // from the legacy-drizzle foundation; without them, a greenfield database (the
  // first app without a cutover) would lack kumiko_events and runProdApp would fail
  // during boot. All three are idempotent (tableExists-gated), so they are no-ops for
  // existing databases.
  await createEventsTable(db);
  await createEventConsumerStateTable(db);
  await createProjectionStateTable(db);
}

function reportAppliedMigrations(out: SchemaCliOut, result: MigrationRunResult): void {
  out.log("");
  if (result.applied.length === 0) {
    out.log(`  ✓ All ${result.skipped.length} migrations already applied.`);
  } else {
    out.log(`  ✓ Applied ${result.applied.length}:`);
    for (const id of result.applied) out.log(`    + ${id}`);
    if (result.skipped.length > 0) out.log(`  (${result.skipped.length} already applied)`);
  }
  out.log("");
}

function configureRebuildKms(wiring: KmsWiring): void {
  if ("kms" in wiring) {
    configurePiiSubjectKms(wiring.kms);
    configureBlindIndexKey(wiring.blindIndexKey);
  }
}

async function rebuildQueuedProjections(
  db: DbConnection,
  ctx: SchemaCliContext,
  features: readonly FeatureDefinition[],
  appliedIds: MigrationRunResult["applied"],
): Promise<void> {
  const thisRunTables = await queueRebuildsFromMarkers(db, {
    migrationsDir: ctx.migrationsDir,
    appliedIds,
  });
  const registry = createRegistry(features);
  const rebuildRun = await runPendingRebuilds(db, registry, { thisRunTables });
  reportPendingRebuildRun(rebuildRun, ctx.out.log);
}

export async function runApplyCommand(ctx: SchemaCliContext): Promise<number> {
  const { out, options, migrationsDir } = ctx;
  const dbUrl = readDatabaseUrlOrReport(out);
  if (dbUrl === undefined) return 1;
  if (!migrationsDirExistsOrReport(ctx)) return 1;
  const rowLevelSecurity = await loadRowLevelSecurityModeOrReport(ctx);
  if (rowLevelSecurity === undefined) return 1;
  const { db, close } = createDbConnection({ url: dbUrl, rowLevelSecurity });
  let wiring: KmsWiring | undefined;
  try {
    const result = await runMigrationsFromDir(db, migrationsDir);
    await ensureFrameworkInfrastructureTables(db);
    reportAppliedMigrations(out, result);

    // Projection-rebuild for tables a freshly applied migration changed
    // (marker NNNN_<name>.rebuild.json from `generate`). Needs the composed
    // feature set → only when the caller passed `features` (the app bin);
    // the dev CLI omits it and applies migrations only. Runs unconditionally
    // (not gated on result.applied.length > 0): a persistent queue
    // (kumiko_pending_rebuilds) survives a failed/crashed rebuild from an
    // earlier apply, so a later apply with zero new migrations still must
    // retry it — otherwise a failed rebuild is silently never retried,
    // since the migration itself is already tracked applied.
    if (options.features) {
      // A rebuild replays applyEntityEvent, which computes bidx columns from
      // configureBlindIndexKey/configurePiiSubjectKms — both boot-injected by
      // run{Prod,Dev}App but never by this standalone CLI (the migrate-db
      // initContainer). Without wiring them here, a rebuild would silently
      // null out bidx columns and, for ciphertext, throw only once it hits
      // the row.
      wiring = await resolveKmsWiringAsync(process.env, {
        logPrefix: "[kumiko schema apply]",
        log: out.log,
        slots: options.kmsSlots,
      });
      configureRebuildKms(wiring);
      await rebuildQueuedProjections(db, ctx, options.features, result.applied);
    }
    return 0;
  } catch (e) {
    out.err("");
    out.err(`  ✗ ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    out.err("");
    return 1;
  } finally {
    await wiring?.close();
    await close();
  }
}
