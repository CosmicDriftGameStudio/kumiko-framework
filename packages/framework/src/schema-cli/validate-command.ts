import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  assertRowLevelSecurityTableState,
  createDbConnection,
  generateMigration,
} from "../db/index.ts";
import { isLiveFrameworkTable, type KnownTables } from "../db/known-table-names.ts";
import { readMigrationSqlTexts } from "../db/migrate-runner.ts";
import { diffReplayAgainstSnapshot, replayMigrationsDir } from "../db/replay-migration-sql.ts";
import {
  BootValidationError,
  type BootViolation,
  bootRuleDocLink,
} from "../engine/boot-validator/boot-rule.ts";
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
    rowLevelSecurity: schemaMod.rowLevelSecurity,
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

type BootOutcome = {
  readonly ok: boolean;
  readonly skipped?: true;
  readonly violations: readonly BootViolation[];
};

function unclassifiedViolation(check: string, e: unknown): BootViolation {
  return { ruleId: `unclassified/${check}`, check, message: describeThrown(e) };
}

function reportBootViolations(out: SchemaCliOut, violations: readonly BootViolation[]): void {
  for (const v of violations) {
    out.err(`  ✗ boot [${v.ruleId}] ${v.message}`);
    if (v.fix !== undefined) out.err(`    Fix: ${v.fix}`);
    const docLink = bootRuleDocLink(v.ruleId);
    if (docLink !== undefined) out.err(`    Rule: ${docLink}`);
  }
}

// 2. Boot validity — needs the composed feature set.
function checkBootValidity(out: SchemaCliOut, schemaMod: SchemaMod): BootOutcome {
  let bootFeatures: ReturnType<typeof featureDefinitionsOf>;
  try {
    bootFeatures = featureDefinitionsOf(schemaMod.features);
  } catch (e) {
    out.err(`  ✗ boot: ${describeThrown(e)}`);
    return { ok: false, violations: [unclassifiedViolation("featureDefinitionsOf", e)] };
  }
  if (bootFeatures === undefined) {
    out.log(
      "  · boot: skipped — add `export const FEATURES = composeFeatures(APP_FEATURES, { includeBundled: true })` to kumiko/schema.ts to enable validateBoot.",
    );
    return { ok: true, skipped: true, violations: [] };
  }
  try {
    validateBoot(bootFeatures, {
      ...parseValidateBootOptions(schemaMod.validateBootOptions),
      env: withFileStoragePresence(process.env),
    });
    out.log("  ✓ boot: feature configuration is valid");
    return { ok: true, violations: [] };
  } catch (e) {
    if (e instanceof BootValidationError) {
      reportBootViolations(out, e.violations);
      return { ok: false, violations: e.violations };
    }
    out.err(`  ✗ boot: ${describeThrown(e)}`);
    return { ok: false, violations: [unclassifiedViolation("validateBoot", e)] };
  }
}

function declaredTablesOf(schemaMod: SchemaMod): KnownTables {
  const names = new Set(schemaMod.entityMetas.map((meta) => meta.tableName));
  return { has: (tableName) => names.has(tableName) || isLiveFrameworkTable(tableName) };
}

// 4. Live row-level security table state — the table half of the boot check. Only with a DATABASE_URL;
// without one the command stays database-free. Scoped to the tables kumiko/schema.ts declares plus the
// framework tables, because a local DATABASE_URL may point at a dev database several apps share.
async function checkLiveRowLevelSecurity(
  out: SchemaCliOut,
  schemaMod: SchemaMod,
): Promise<boolean> {
  const dbUrl = process.env["DATABASE_URL"];
  if (!dbUrl) {
    out.log("  · row-level security: skipped — set DATABASE_URL to check the live database.");
    return true;
  }
  const { db, close } = createDbConnection({
    url: dbUrl,
    maxConnections: 1,
    rowLevelSecurity: schemaMod.rowLevelSecurity,
  });
  try {
    await assertRowLevelSecurityTableState(
      db,
      schemaMod.rowLevelSecurity,
      declaredTablesOf(schemaMod),
      "declared tables",
    );
    out.log(
      "  ✓ row-level security: live database matches the configured mode for this app's tables and the framework tables (tables of other apps sharing the database are not checked)",
    );
    return true;
  } catch (e) {
    out.err(`  ✗ row-level security: ${describeThrown(e)}`);
    return false;
  } finally {
    try {
      await close();
    } catch {
      // The check result is already reported; a failing close must not hide it.
    }
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
//      honours its optional VALIDATE_BOOT_OPTIONS export. `--json` prints
//      this result as one JSON document on stdout.
//   3. migration-content drift: replay every committed *.sql file and
//      diff the result against .snapshot.json — catches a migration
//      file whose SQL body doesn't match what its own snapshot entry
//      claims (e.g. an accidental copy-paste from an earlier file).
//      Layer 1 alone misses this: it only compares ENTITY_METAS to the
//      snapshot, never the snapshot to the SQL that's supposed to have
//      produced it.
//   4. live row-level security (only with DATABASE_URL): the boot's
//      table-state check against the real database (not the role: that is a boot-time property).
// The DB-level gate (assertKumikoSchemaCurrent) stays at boot/deploy.
function printBootJson(ctx: SchemaCliContext, boot: BootOutcome): void {
  const { ok, skipped, violations } = boot;
  ctx.out.log(JSON.stringify({ boot: { ok, ...(skipped ? { skipped } : {}), violations } }));
}

export async function runValidateCommand(ctx: SchemaCliContext): Promise<number> {
  const jsonMode = ctx.argv.includes("--json");
  // stdout carries exactly one JSON document in --json mode.
  const out: SchemaCliOut = jsonMode ? { log: ctx.out.err, err: ctx.out.err } : ctx.out;
  const humanCtx: SchemaCliContext = { ...ctx, out };
  const schemaMod = await loadSchemaModOrReport(humanCtx);
  if (schemaMod === undefined) {
    if (jsonMode) {
      const message = "kumiko/schema.ts could not be loaded";
      printBootJson(ctx, {
        ok: false,
        violations: [{ ruleId: "unclassified/loadSchemaMod", check: "loadSchemaMod", message }],
      });
    }
    return 1;
  }
  const prevSnapshot = loadPreviousSnapshot(join(ctx.migrationsDir, SNAPSHOT_FILENAME));
  const schemaOk = checkSchemaDrift(humanCtx, schemaMod, prevSnapshot);
  const boot = checkBootValidity(out, schemaMod);
  const migrationsOk = checkMigrationContentDrift(humanCtx, prevSnapshot);
  const rowLevelSecurityOk = await checkLiveRowLevelSecurity(out, schemaMod);
  if (jsonMode) printBootJson(ctx, boot);
  return schemaOk && boot.ok && migrationsOk && rowLevelSecurityOk ? 0 : 1;
}
