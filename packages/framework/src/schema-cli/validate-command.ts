import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  diffReplayAgainstSnapshot,
  generateMigration,
  readMigrationSqlTexts,
  replayMigrationsDir,
} from "../db/index.ts";
import { validateBoot } from "../engine/boot-validator.ts";
import {
  describeThrown,
  loadPreviousSnapshot,
  loadSchemaModOrReport,
  nextSequenceNumber,
  type SchemaCliContext,
  type SchemaCliOut,
  type SchemaMod,
  SNAPSHOT_FILENAME,
} from "./shared.ts";
import {
  featureDefinitionsOf,
  parseValidateBootOptions,
  withFileStoragePresence,
} from "./validate-boot-input.ts";

type PreviousSnapshot = ReturnType<typeof loadPreviousSnapshot>;

// 1. Schema drift — compute the diff, never write.
function checkSchemaDrift(
  ctx: SchemaCliContext,
  schemaMod: SchemaMod,
  prevSnapshot: PreviousSnapshot,
): boolean {
  const { out, migrationsDir } = ctx;
  const drift = generateMigration({
    metas: schemaMod.entityMetas,
    prevSnapshot,
    name: "validate",
    sequenceNumber: nextSequenceNumber(migrationsDir),
    priorMigrationsSql: readMigrationSqlTexts(migrationsDir),
  });
  const pendingTables = [
    ...drift.diff.newTables.map((t) => t.tableName),
    ...drift.diff.changedTables.map((t) => t.tableName),
    ...drift.diff.droppedTables,
    ...drift.retiredDrops.map((t) => t.tableName),
    ...drift.rowLevelSecurityChanges.map((c) => c.tableName),
  ];
  if (pendingTables.length === 0) {
    out.log("  ✓ schema: migrations match the entity definitions");
    return true;
  }
  out.err("  ✗ schema drift: entity definitions are ahead of kumiko/migrations.");
  out.err(
    `    pending — new: ${drift.diff.newTables.length}, changed: ${drift.diff.changedTables.length}, dropped: ${drift.diff.droppedTables.length}, row level security: ${drift.rowLevelSecurityChanges.length}`,
  );
  out.err(`    tables: ${pendingTables.join(", ")}`);
  out.err("    Fix: `kumiko-schema generate <name>`, then commit the migration.");
  return false;
}

// 2. Boot validity — needs the composed feature set.
function checkBootValidity(out: SchemaCliOut, schemaMod: SchemaMod): boolean {
  let bootFeatures: ReturnType<typeof featureDefinitionsOf>;
  try {
    bootFeatures = featureDefinitionsOf(schemaMod.features);
  } catch (e) {
    out.err(`  ✗ boot: ${describeThrown(e)}`);
    return false;
  }
  if (bootFeatures === undefined) {
    out.log(
      "  · boot: skipped — add `export const FEATURES = composeFeatures(APP_FEATURES, { includeBundled: true })` to kumiko/schema.ts to enable validateBoot.",
    );
    return true;
  }
  try {
    validateBoot(bootFeatures, {
      ...parseValidateBootOptions(schemaMod.validateBootOptions),
      env: withFileStoragePresence(process.env),
    });
    out.log("  ✓ boot: feature configuration is valid");
    return true;
  } catch (e) {
    out.err(`  ✗ boot: ${describeThrown(e)}`);
    return false;
  }
}

type ReplayMismatches = ReturnType<typeof diffReplayAgainstSnapshot>;

function reportMigrationContentMismatches(out: SchemaCliOut, mismatches: ReplayMismatches): void {
  out.err("  ✗ migration-content drift: committed *.sql files don't produce .snapshot.json.");
  for (const m of mismatches) {
    out.err(`    ${m.tableName} (${m.kind}): ${m.detail}`);
  }
  if (mismatches.some((m) => m.kind === "unexpected-table")) {
    out.err(
      "    Fix (unexpected-table): build a meta via `defineUnmanagedTable()` " +
        "from `@cosmicdrift/kumiko-framework/db`, then `r.storeTable(meta, { reason: ... })` " +
        "inside a feature — this adds it to ENTITY_METAS immediately; the .snapshot.json " +
        "only picks it up on the NEXT `kumiko-schema generate` run, which you still need " +
        "to run and commit. `table()` returns a query handle, not a storeTable()-compatible " +
        "meta — don't pass its result to storeTable(). See the bundled `jobs` feature's " +
        "job-run-log store table for the pattern.",
    );
  }
  if (mismatches.some((m) => m.kind !== "unexpected-table")) {
    out.err(
      "    Fix (missing-table/column-drift/row-level-security-drift): a migration file's body doesn't match " +
        "what it (or the snapshot) claims — hand-fix the file, or ship a corrective " +
        "migration if it's already applied in prod.",
    );
  }
}

// 3. Migration-content drift — replay the committed *.sql files and
// diff the reconstructed schema against .snapshot.json.
function checkMigrationContentDrift(
  ctx: SchemaCliContext,
  prevSnapshot: PreviousSnapshot,
): boolean {
  const { out, migrationsDir } = ctx;
  if (!existsSync(migrationsDir) || prevSnapshot === null) return true;
  try {
    const replayed = replayMigrationsDir(migrationsDir);
    const mismatches = diffReplayAgainstSnapshot(replayed, prevSnapshot);
    if (mismatches.length === 0) {
      out.log("  ✓ migrations: table/column names match .snapshot.json");
      return true;
    }
    reportMigrationContentMismatches(out, mismatches);
    return false;
  } catch (e) {
    // replayMigrationsDir fail-loud's on a table-DDL statement it can't
    // parse — that must surface as a normal ✗ line like every other
    // check here, not a raw stack trace that kills the process before
    // any later check (or the Fix: help) ever runs.
    out.err(`  ✗ migration-content: ${describeThrown(e)}`);
    out.err(
      "    Fix: a statement in a migration file isn't recognizable to the replay parser — extend the parser's recognized patterns, or reword the migration to one it understands.",
    );
    return false;
  }
}

// Static, DB-free boot-blocking checks for CI — catches "this won't boot"
// before deploy. Three layers, no database:
//   1. schema drift: would `generate` write a migration? (= an entity was
//      added/changed but never generated → missing table → prod 500)
//   2. boot validity: validateBoot over the composed FEATURES (QN/screen/
//      nav/role refs). Runs only if kumiko/schema.ts exports FEATURES;
//      honours its optional VALIDATE_BOOT_OPTIONS export.
//   3. migration-content drift: replay every committed *.sql file and
//      diff the result against .snapshot.json — catches a migration
//      file whose SQL body doesn't match what its own snapshot entry
//      claims (e.g. an accidental copy-paste from an earlier file).
//      Layer 1 alone misses this: it only compares ENTITY_METAS to the
//      snapshot, never the snapshot to the SQL that's supposed to have
//      produced it.
// The DB-level gate (assertKumikoSchemaCurrent) stays at boot/deploy.
export async function runValidateCommand(ctx: SchemaCliContext): Promise<number> {
  const schemaMod = await loadSchemaModOrReport(ctx);
  if (schemaMod === undefined) return 1;
  const prevSnapshot = loadPreviousSnapshot(join(ctx.migrationsDir, SNAPSHOT_FILENAME));
  const schemaOk = checkSchemaDrift(ctx, schemaMod, prevSnapshot);
  const bootOk = checkBootValidity(ctx.out, schemaMod);
  const migrationsOk = checkMigrationContentDrift(ctx, prevSnapshot);
  return schemaOk && bootOk && migrationsOk ? 0 : 1;
}
