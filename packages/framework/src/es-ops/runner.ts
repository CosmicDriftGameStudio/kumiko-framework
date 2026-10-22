// Runner for pending seed migrations during boot.
//
// Flow:
//   1. List seeds/<*.ts> sorted ascending (filename = chronological ID)
//   2. SELECT id FROM kumiko_es_operations WHERE operation_type='seed-migration'
//   3. pending = files \\ applied
//   4. For each pending migration in order:
//      a. dynamic import → default export (SeedMigration)
//      b. if migration.skippable && env[KUMIKO_SKIP_ES_OPS_<sanitized>]='1':
//         → log line + continue (no marker written)
//      c. Start transaction
//      d. await migration.run(ctx)
//      e. INSERT marker with duration_ms + appliedBy
//      f. Commit transaction
//   5. On any failure: transaction rollback + error log + throw
//      → App boot aborts. The operator must fix the failure and retry.
//
// Emergency skip pattern: seed.skippable=true permits a
// `KUMIKO_SKIP_ES_OPS_<id>=1` env flag to skip a broken migration
// without touching its code. NOT a standard workflow — emergency use only.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { DbConnection, DbRunner } from "../db/index.ts";
import { acquireEsOpsAdvisoryLock, esOperationExists } from "../db/queries/es-ops.ts";
import { insertOne, selectMany } from "../db/query.ts";
import type { Registry } from "../engine/index.ts";
import { createFallbackLogger } from "../logging/utils.ts";
import { esOperationsTable } from "./operations-schema.ts";
import type { EsOperationAppliedBy, SeedMigration, SeedMigrationContext } from "./types.ts";

export type RunPendingSeedMigrationsArgs = {
  readonly db: DbConnection;
  /** Absolute path to the seeds directory (typically <appRoot>/seeds). */
  readonly seedsDir: string;
  /** Factory that creates the context for each seed migration.
   * The caller receives a DbRunner (connection OR active transaction); the
   * runner invokes this once per migration within the transaction scope. */
  readonly createContext: (dbRunner: DbRunner) => SeedMigrationContext;
  /** Trace-marker: boot | cli | ci-pipeline. Landet in applied_by. */
  readonly appliedBy: EsOperationAppliedBy;
  /** Optional registry for dry-run validation: parses each seed file and
   * checks that all referenced handler QNs exist in the registry
   * BEFORE the migration runs. This catches camelCase typos and other QN
   * drift at boot rather than in the middle of a write cycle.
   *
   * If omitted, no dry run is performed (backward compatibility for tests
   * that do not provide a registry). runProdApp supplies the correct one. */
  readonly registry?: Registry;
  /** Optional line sink; the default logs under the "es-ops/seed-migration" namespace. */
  readonly logger?: (line: string) => void;
};

export type RunPendingSeedMigrationsResult = {
  readonly appliedIds: readonly string[];
  readonly skippedIds: readonly string[];
};

const seedMigrationLog = createFallbackLogger("es-ops/seed-migration");
const DEFAULT_LOGGER = (line: string): void => seedMigrationLog.info(line);

export async function runPendingSeedMigrations(
  args: RunPendingSeedMigrationsArgs,
): Promise<RunPendingSeedMigrationsResult> {
  const log = args.logger ?? DEFAULT_LOGGER;

  const onDisk = await listSeedFiles(args.seedsDir);
  if (onDisk.length === 0) {
    log(`no seed files in ${args.seedsDir} — skipping`);
    return { appliedIds: [], skippedIds: [] };
  }

  const applied = await loadAppliedIds(args.db);
  const pending = onDisk.filter((entry) => !applied.has(entry.id));
  if (pending.length === 0) {
    log(`${onDisk.length} on disk, all applied — nothing to do`);
    return { appliedIds: [], skippedIds: [] };
  }

  log(`${pending.length}/${onDisk.length} pending`);

  const appliedIds: string[] = [];
  const skippedIds: string[] = [];

  // Dry-run pass: before any migration, parse all handler QNs from the seed
  // files and check them against the registry. Fail fast before the first
  // write, with a clear error containing the file and QN instead of a runtime
  // "handler not found" error in the middle of the migration flow.
  if (args.registry !== undefined) {
    const unknownQns: Array<{ id: string; qn: string }> = [];
    for (const entry of pending) {
      const source = await readFile(entry.filePath, "utf-8");
      for (const qn of extractWriteHandlerQns(source)) {
        if (!args.registry.getWriteHandler(qn)) {
          unknownQns.push({ id: entry.id, qn });
        }
      }
    }
    if (unknownQns.length > 0) {
      const lines = unknownQns.map((u) => `  - ${u.id}: "${u.qn}" not registered`);
      throw new Error(
        `[es-ops/seed-migration] dry-run found ${unknownQns.length} unknown handler-QN(s):\n${lines.join(
          "\n",
        )}\n  Check spelling against your TenantHandlers/AuthHandlers constants (kebab-case after the colon).`,
      );
    }
    log(`dry-run ok — all referenced handler-QNs registered`);
  }

  for (const entry of pending) {
    const migration = await loadSeedModule(entry.filePath);

    const envFlag = `KUMIKO_SKIP_ES_OPS_${sanitizeForEnv(entry.id)}`;
    if (migration.skippable === true && process.env[envFlag] === "1") {
      log(`skip "${entry.id}" — ${envFlag}=1`);
      skippedIds.push(entry.id);
      continue;
    }

    const start = Date.now();
    try {
      await args.db.begin(async (tx: DbRunner) => {
        // Advisory lock: serializes multi-replica boots. The second pod blocks until
        // the first finishes, then rechecks its applied set in the next
        // iteration and finds the marker, so it skips the migration. The lock
        // is released automatically when the transaction commits (xact scope).
        await acquireEsOpsAdvisoryLock(tx);

        if (await esOperationExists(tx, entry.id)) {
          log(`race-skip "${entry.id}" — applied by parallel boot`);
          // skip: parallel boot won the advisory-lock and already applied
          // this migration. Nothing more to do in this tx.
          return;
        }

        const ctx = args.createContext(tx);
        await migration.run(ctx);
        await insertOne(tx, esOperationsTable, {
          id: entry.id,
          operationType: "seed-migration",
          durationMs: Date.now() - start,
          appliedBy: args.appliedBy,
          notes: migration.description,
        });
      });
      const elapsed = Date.now() - start;
      log(`✓ ${entry.id} (${elapsed}ms) — ${migration.description}`);
      appliedIds.push(entry.id);
    } catch (err) {
      const elapsed = Date.now() - start;
      log(`✗ ${entry.id} (${elapsed}ms) — ${stringifyError(err)}`);
      log(
        `ABORT — ${pending.length - appliedIds.length - skippedIds.length - 1} pending migrations were NOT attempted`,
      );
      throw err;
    }
  }

  return { appliedIds, skippedIds };
}

type SeedFileEntry = { readonly id: string; readonly filePath: string };

async function listSeedFiles(seedsDir: string): Promise<readonly SeedFileEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(seedsDir);
  } catch {
    // A missing directory is treated as empty. An app without a seeds directory
    // is a valid no-op state.
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".ts") || name.endsWith(".mts") || name.endsWith(".js"))
    .filter((name) => !name.startsWith("_") && !name.startsWith("."))
    .sort() // filename = chronologische ID (date-prefix-convention)
    .map((name) => ({
      id: name.replace(/\.(ts|mts|js)$/, ""),
      // Resolve rather than join: Bun's await import() requires absolute paths.
      // If seedsDir is relative (for example "./seeds" from a runProdApp
      // option), the joined path would also be relative. Bun's import resolver
      // would resolve it relative to runner.ts rather than process.cwd(),
      // causing "Cannot find module 'seeds/...' from '<runner-path>'".
      filePath: path.resolve(seedsDir, name),
    }));
}

async function loadAppliedIds(db: DbConnection): Promise<Set<string>> {
  const rows = await selectMany<{ id: string }>(db, esOperationsTable, {
    operationType: "seed-migration",
  });
  return new Set(rows.map((r) => r.id));
}

async function loadSeedModule(filePath: string): Promise<SeedMigration> {
  // Bun + Node both honor dynamic import on absolute paths. The seed-files
  // must export their SeedMigration as default.
  const mod = await import(filePath);
  const migration: unknown = mod.default;
  if (!isSeedMigration(migration)) {
    throw new Error(
      `[es-ops] seed file ${filePath} must export a SeedMigration as default ` +
        `(object with { description: string, run: (ctx) => Promise<void> })`,
    );
  }
  return migration;
}

function isSeedMigration(value: unknown): value is SeedMigration {
  if (typeof value !== "object" || value === null) return false;
  // @cast-boundary generic-record — narrowing unknown to property-bag for shape-check
  const v = value as Partial<SeedMigration>;
  return typeof v.description === "string" && typeof v.run === "function";
}

// "2026-05-20-fix-admin-roles" → "2026_05_20_FIX_ADMIN_ROLES"
function sanitizeForEnv(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

// Parse seed-file source and extract handler QNs from `systemWriteAs(...)`
// calls. A regex (rather than an AST) handles common inline string cases:
//   ctx.systemWriteAs("foo:write:bar", payload)
//   systemWriteAs("foo:write:bar", ...)  (destructured)
//
// Unsupported cases:
//   - QN from a variable: `const qn = "..."; ctx.systemWriteAs(qn, ...)`
//   - String concatenation or template literals with dynamic variables
// These patterns are uncommon in real seed migrations. This limitation is
// documented so callers requiring dynamic QNs understand the constraint.
function extractWriteHandlerQns(source: string): readonly string[] {
  const pattern = /systemWriteAs\s*\(\s*["']([^"']+)["']/g;
  const out = new Set<string>();
  for (const match of source.matchAll(pattern)) {
    const qn = match[1];
    if (qn) out.add(qn);
  }
  return [...out];
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
