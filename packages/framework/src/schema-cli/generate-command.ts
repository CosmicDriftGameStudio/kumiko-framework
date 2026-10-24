import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateMigration, writeSnapshotJson } from "../db/index.ts";
import { assertValidMigrationName, hasNoSchemaChanges } from "../db/migrate-generator.ts";
import { readMigrationSqlTexts } from "../db/migrate-runner.ts";
import { rebuildTablesFromDiff, writeRebuildMarker } from "../db/rebuild-marker.ts";
import {
  describeThrown,
  loadPreviousSnapshot,
  loadSchemaModOrReport,
  nextSequenceNumber,
  type SchemaCliContext,
  type SchemaCliOut,
  SNAPSHOT_FILENAME,
} from "./shared.ts";

const GENERATE_USAGE = "  Usage: schema generate <name>";

type GenerateNameResult =
  | { readonly kind: "exit"; readonly code: number }
  | { readonly kind: "name"; readonly name: string };

function parseGenerateName(ctx: SchemaCliContext): GenerateNameResult {
  const { argv, out } = ctx;
  const name = argv[1];
  if (name === "--help" || name === "-h") {
    out.log(GENERATE_USAGE);
    return { kind: "exit", code: 0 };
  }
  if (!name) {
    out.err(GENERATE_USAGE);
    return { kind: "exit", code: 1 };
  }
  // name lands unescaped in `${seq}_${name}.sql` (generateMigration) —
  // shared allowlist blocks flag-like names, path traversal, and
  // ENAMETOOLONG-length names.
  try {
    assertValidMigrationName(name);
  } catch (e) {
    out.err(`  ${describeThrown(e)}`);
    out.err(GENERATE_USAGE);
    return { kind: "exit", code: 1 };
  }
  // Trailing args (e.g. a typo'd `--dry-run` — there is no such flag) were
  // silently ignored and the migration got written anyway. Reject them
  // before any IO instead of pretending they did something.
  if (argv.length > 2) {
    out.err(`  Unrecognized argument(s): ${argv.slice(2).join(" ")}`);
    out.err(GENERATE_USAGE);
    return { kind: "exit", code: 1 };
  }
  return { kind: "name", name };
}

type GeneratedMigration = ReturnType<typeof generateMigration>;

function writeMigrationFiles(
  migrationsDir: string,
  snapshotPath: string,
  result: GeneratedMigration,
): void {
  if (!existsSync(migrationsDir)) mkdirSync(migrationsDir, { recursive: true });
  writeFileSync(join(migrationsDir, result.filename), result.sqlContent);
  writeSnapshotJson(snapshotPath, result.snapshot);
}

function reportGeneratedMigration(
  out: SchemaCliOut,
  result: GeneratedMigration,
  rebuildTables: readonly string[],
): void {
  out.log("");
  out.log(`  ✓ ${result.filename}`);
  out.log(
    `    new tables: ${result.diff.newTables.length}, changed: ${result.diff.changedTables.length}, dropped: ${result.diff.droppedTables.length}, retired framework tables dropped: ${result.retiredDrops.length}, row level security changes: ${result.rowLevelSecurityChanges.length}`,
  );
  if (rebuildTables.length > 0) {
    out.log(
      `    rebuild-marker: ${result.filename.replace(/\.sql$/, ".rebuild.json")} (${rebuildTables.length} table(s))`,
    );
  }
  out.log("");
  out.log("  Review, hand-edit if needed, then git add + commit. Apply via: schema apply");
  out.log("");
}

export async function runGenerateCommand(ctx: SchemaCliContext): Promise<number> {
  const { out, migrationsDir } = ctx;
  const parsed = parseGenerateName(ctx);
  if (parsed.kind === "exit") return parsed.code;
  const schemaMod = await loadSchemaModOrReport(ctx);
  if (schemaMod === undefined) return 1;
  const snapshotPath = join(migrationsDir, SNAPSHOT_FILENAME);
  const prevSnapshot = loadPreviousSnapshot(snapshotPath);
  const result = generateMigration({
    metas: schemaMod.entityMetas,
    rowLevelSecurity: schemaMod.rowLevelSecurity,
    prevSnapshot,
    name: parsed.name,
    sequenceNumber: nextSequenceNumber(migrationsDir),
    priorMigrationsSql: readMigrationSqlTexts(migrationsDir),
  });

  if (hasNoSchemaChanges(result)) {
    out.log("  No schema changes detected — no new migration file written.");
    return 0;
  }

  writeMigrationFiles(migrationsDir, snapshotPath, result);

  // Rebuild markers are written only for incremental migrations — the initial
  // migration (prevSnapshot===null) only creates tables, so there are no historical
  // events to replay.
  const rebuildTables = prevSnapshot === null ? [] : rebuildTablesFromDiff(result.diff);
  writeRebuildMarker(migrationsDir, result.filename, rebuildTables);

  reportGeneratedMigration(out, result, rebuildTables);
  return 0;
}
