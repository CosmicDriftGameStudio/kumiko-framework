// Runner für pending seed-migrations beim Boot.
//
// Flow:
//   1. List seeds/<*.ts> sorted ascending (filename = chronologische ID)
//   2. SELECT id FROM kumiko_es_operations WHERE operation_type='seed-migration'
//   3. pending = files \ applied
//   4. Für jeden pending in Order:
//      a. dynamic import → default-export (SeedMigration)
//      b. wenn migration.skippable && env[KUMIKO_SKIP_ES_OPS_<sanitized>]='1':
//         → console.log + continue (kein Marker geschrieben)
//      c. Tx start
//      d. await migration.run(ctx)
//      e. INSERT marker mit duration_ms + appliedBy
//      f. Tx commit
//   5. On any failure: Tx rollback + console.error + throw
//      → App-Boot bricht ab. Operator muss Failure fixen + retry.
//
// Skippable-Pattern: seed.skippable=true erlaubt im Notfall ein
// `KUMIKO_SKIP_ES_OPS_<id>=1` env-flag um eine kaputte Migration zu
// überspringen ohne ihr Code touchen zu müssen. NICHT als
// Standard-Workflow — wirklich Notfall.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { DbConnection, DbRunner } from "../db";
import { acquireEsOpsAdvisoryLock, esOperationExists } from "../db/queries/es-ops";
import { insertOne, selectMany } from "../db/query";
import type { Registry } from "../engine";
import { esOperationsTable } from "./operations-schema";
import type { EsOperationAppliedBy, SeedMigration, SeedMigrationContext } from "./types";

export type RunPendingSeedMigrationsArgs = {
  readonly db: DbConnection;
  /** Absoluter Pfad zum seeds-Directory (typically <appRoot>/seeds). */
  readonly seedsDir: string;
  /** Factory die den Context für jede einzelne seed-Migration erzeugt.
   *  Caller bekommt einen DbRunner (Connection ODER aktive Tx) — Runner
   *  ruft das pro-migration im tx-Scope auf. */
  readonly createContext: (dbRunner: DbRunner) => SeedMigrationContext;
  /** Trace-marker: boot | cli | ci-pipeline. Landet in applied_by. */
  readonly appliedBy: EsOperationAppliedBy;
  /** Optional registry für Dry-Run-Validation: parsed jeden seed-file und
   *  checkt dass alle referenzierten handler-QNs in der Registry existieren
   *  BEVOR die Migration läuft. Catched camelCase-typos + andere QN-Drift
   *  zur Boot-Zeit statt mitten im write-cycle (Phase 1.5 / A2).
   *
   *  Wenn weggelassen → kein Dry-Run (backward-compat für tests die ohne
   *  Registry arbeiten). runProdApp reicht den richtigen Registry rein. */
  readonly registry?: Registry;
  /** Optional log-prefix override, default "[es-ops/seed-migration]". */
  readonly logger?: (line: string) => void;
};

export type RunPendingSeedMigrationsResult = {
  readonly appliedIds: readonly string[];
  readonly skippedIds: readonly string[];
};

const DEFAULT_LOGGER = (line: string): void => {
  // biome-ignore lint/suspicious/noConsole: boot-time-output, kein Logger-Inject hier
  console.log(line);
};

const LOG_PREFIX = "[es-ops/seed-migration]";

export async function runPendingSeedMigrations(
  args: RunPendingSeedMigrationsArgs,
): Promise<RunPendingSeedMigrationsResult> {
  const log = args.logger ?? DEFAULT_LOGGER;

  const onDisk = await listSeedFiles(args.seedsDir);
  if (onDisk.length === 0) {
    log(`${LOG_PREFIX} no seed files in ${args.seedsDir} — skipping`);
    return { appliedIds: [], skippedIds: [] };
  }

  const applied = await loadAppliedIds(args.db);
  const pending = onDisk.filter((entry) => !applied.has(entry.id));
  if (pending.length === 0) {
    log(`${LOG_PREFIX} ${onDisk.length} on disk, all applied — nothing to do`);
    return { appliedIds: [], skippedIds: [] };
  }

  log(`${LOG_PREFIX} ${pending.length}/${onDisk.length} pending`);

  const appliedIds: string[] = [];
  const skippedIds: string[] = [];

  // Dry-Run-Pass (Phase 1.5 / A2): vor JEDER migration alle handler-QNs aus
  // den seed-files parsen + gegen registry checken. Fail-fast vor erstem
  // write — gibt klare error-message mit Datei + qn statt zur runtime
  // "handler not found" mitten im migration-flow.
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
    log(`${LOG_PREFIX} dry-run ok — all referenced handler-QNs registered`);
  }

  for (const entry of pending) {
    const migration = await loadSeedModule(entry.filePath);

    const envFlag = `KUMIKO_SKIP_ES_OPS_${sanitizeForEnv(entry.id)}`;
    if (migration.skippable === true && process.env[envFlag] === "1") {
      log(`${LOG_PREFIX} skip "${entry.id}" — ${envFlag}=1`);
      skippedIds.push(entry.id);
      continue;
    }

    const start = Date.now();
    try {
      await args.db.begin(async (tx: DbRunner) => {
        // Advisory-Lock: sequentialisiert Multi-Replica-Boots. Zweiter
        // Pod blockt bis erster fertig ist, dann re-checked sein
        // applied-set (außerhalb dieser Funktion in nächster Iteration)
        // und findet den Marker → skip. Lock wird beim Tx-Commit
        // automatisch released (xact-scope).
        await acquireEsOpsAdvisoryLock(tx);

        if (await esOperationExists(tx, entry.id)) {
          log(`${LOG_PREFIX} race-skip "${entry.id}" — applied by parallel boot`);
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
      log(`${LOG_PREFIX} ✓ ${entry.id} (${elapsed}ms) — ${migration.description}`);
      appliedIds.push(entry.id);
    } catch (err) {
      const elapsed = Date.now() - start;
      log(`${LOG_PREFIX} ✗ ${entry.id} (${elapsed}ms) — ${stringifyError(err)}`);
      log(
        `${LOG_PREFIX} ABORT — ${pending.length - appliedIds.length - skippedIds.length - 1} pending migrations were NOT attempted`,
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
    // Directory doesn't exist → treat as empty. App ohne seeds-Dir ist
    // ein valider Zustand (no-op).
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".ts") || name.endsWith(".mts") || name.endsWith(".js"))
    .filter((name) => !name.startsWith("_") && !name.startsWith("."))
    .sort() // filename = chronologische ID (date-prefix-convention)
    .map((name) => ({
      id: name.replace(/\.(ts|mts|js)$/, ""),
      // resolve, nicht join: Bun's await import() braucht absolute Pfade.
      // Wenn seedsDir relativ ist (z.B. "./seeds" aus runProdApp-Option),
      // wäre der join-Pfad auch relativ → Bun's import-resolver such
      // relativ zum runner.ts-Modul, nicht zu process.cwd() → fail mit
      // "Cannot find module 'seeds/...' from '<runner-path>'".
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

// Parse seed-file source + extract handler-QNs aus `systemWriteAs(...)`-
// Calls. Reine regex (kein AST) — fängt die häufigen Inline-String-Cases:
//   ctx.systemWriteAs("foo:write:bar", payload)
//   systemWriteAs("foo:write:bar", ...)  (destructured)
//
// Edge-Cases die NICHT geguckt werden:
//   - QN aus Variable: `const qn = "..."; ctx.systemWriteAs(qn, ...)`
//   - String-Concat / Template-Literals mit dynamic vars
// Diese Pattern sind selten in real seed-migrations + bleibt als known-
// limitation dokumentiert. Wer dynamic-QN braucht, weiß was er tut.
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
