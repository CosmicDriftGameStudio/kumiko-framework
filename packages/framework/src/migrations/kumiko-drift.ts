// Drizzle-free schema-drift gate for the `kumiko/migrations` system.
//
// Replaces the drizzle-journal gate (schema-drift.ts). Validates two layers
// against the checked-in artifacts:
//
//   1. Migrations applied: every `kumiko/migrations/*.sql` has a row in
//      `_kumiko_migrations`. Applied-but-edited (checksum mismatch) is drift.
//   2. Tables exist: every table in `kumiko/migrations/.snapshot.json` exists.
//   3. Columns exist: every column the snapshot declares for an existing table
//      is present in the live schema. A migrated-but-incomplete table (snapshot
//      richer than the DB — e.g. a ride-along column the generator once missed)
//      would otherwise surface only as a runtime-500 on the first write.
//
// Contract (unchanged from the legacy gate): boot VALIDATES only, never
// applies. Apply is the deploy-step `kumiko schema apply` (runMigrationsFromDir).

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DbConnection } from "../db/connection";
import type { EntityTableMeta } from "../db/entity-table-meta";
import { loadSnapshotJson } from "../db/migrate-generator";
import { fetchAppliedMigrations, loadMigrationsFromDir } from "../db/migrate-runner";
import { columnNamesOf, tableExists } from "../db/schema-inspection";

const SNAPSHOT_FILENAME = ".snapshot.json";

export type ChecksumMismatch = {
  readonly id: string;
  readonly expected: string; // checksum recorded in _kumiko_migrations
  readonly actual: string; // checksum of the file on disk now
};

export type MissingColumns = {
  readonly table: string;
  readonly columns: readonly string[];
};

export type KumikoDriftReport = {
  readonly ok: boolean;
  readonly pending: readonly string[];
  readonly checksumMismatches: readonly ChecksumMismatch[];
  readonly missingTables: readonly string[];
  readonly missingColumns: readonly MissingColumns[];
};

export class SchemaDriftError extends Error {
  readonly report: KumikoDriftReport;
  constructor(message: string, report: KumikoDriftReport) {
    super(message);
    this.name = "SchemaDriftError";
    this.report = report;
  }
}

export async function detectKumikoDrift(
  db: DbConnection,
  migrationsDir: string,
): Promise<KumikoDriftReport> {
  // App auf neuer Framework-Version, hat aber `./kumiko/migrations` noch nicht
  // generiert (z.B. erstes Upgrade, custom Schema-Setup ohne kumiko schema
  // generate) → keine local migrations → keine drift. Konsistent zum
  // status-Subcommand, der ebenfalls existsSync-guarded ist. Ohne diesen Guard
  // würde loadMigrationsFromDir → readdirSync synchron ENOENT werfen
  // (plain Error, kein SchemaDriftError) und der Boot crasht roh.
  if (!existsSync(migrationsDir)) {
    return { ok: true, pending: [], checksumMismatches: [], missingTables: [], missingColumns: [] };
  }
  const local = loadMigrationsFromDir(migrationsDir);
  // Frische DB ohne je gelaufenes `kumiko schema apply` → tracking-table fehlt.
  // Das ist kein Fehler, sondern "nichts applied" → alle local sind pending.
  const trackingExists = await tableExists(db, "_kumiko_migrations");
  const applied = trackingExists
    ? new Map((await fetchAppliedMigrations(db)).map((a) => [a.id, a.checksum] as const))
    : new Map<string, string>();

  const pending: string[] = [];
  const checksumMismatches: ChecksumMismatch[] = [];
  for (const m of local) {
    const appliedChecksum = applied.get(m.id);
    if (appliedChecksum === undefined) {
      pending.push(m.id);
    } else if (appliedChecksum !== m.checksum) {
      checksumMismatches.push({ id: m.id, expected: appliedChecksum, actual: m.checksum });
    }
  }

  // Layer 2 — tables from the latest snapshot must exist. No snapshot (app
  // hasn't generated one yet) → skip table-existence, the migrations-applied
  // layer still gates.
  const snapshot = loadSnapshotJson(join(migrationsDir, SNAPSHOT_FILENAME));
  const missingTables: string[] = [];
  const missingColumns: MissingColumns[] = [];
  if (snapshot) {
    const existence = await Promise.all(
      snapshot.tables.map((t) => tableExists(db, t.tableName).then((exists) => ({ t, exists }))),
    );
    const present: EntityTableMeta[] = [];
    for (const { t, exists } of existence) {
      if (exists) present.push(t);
      else missingTables.push(t.tableName);
    }
    // Layer 3 — column-diff for tables that DO exist.
    const columnChecks = await Promise.all(
      present.map((t) =>
        columnNamesOf(db, t.tableName).then((live) => ({
          table: t.tableName,
          columns: t.columns.map((c) => c.name).filter((n) => !live.has(n)),
        })),
      ),
    );
    for (const c of columnChecks) if (c.columns.length > 0) missingColumns.push(c);
  }

  return {
    ok:
      pending.length === 0 &&
      checksumMismatches.length === 0 &&
      missingTables.length === 0 &&
      missingColumns.length === 0,
    pending,
    checksumMismatches,
    missingTables,
    missingColumns,
  };
}

export function formatKumikoDriftReport(report: KumikoDriftReport): string {
  if (report.ok) return "Schema is current.";
  const lines: string[] = ["Schema drift detected:"];
  if (report.pending.length > 0) {
    lines.push(`  ${report.pending.length} unapplied migration(s):`);
    for (const id of report.pending) lines.push(`    - ${id}`);
  }
  if (report.checksumMismatches.length > 0) {
    lines.push(`  ${report.checksumMismatches.length} edited-after-apply migration(s):`);
    for (const m of report.checksumMismatches) {
      lines.push(`    - ${m.id}: db ${m.expected.slice(0, 12)}…, file ${m.actual.slice(0, 12)}…`);
    }
  }
  if (report.missingTables.length > 0) {
    lines.push(`  ${report.missingTables.length} missing table(s):`);
    for (const t of report.missingTables) lines.push(`    - ${t}`);
  }
  if (report.missingColumns.length > 0) {
    const count = report.missingColumns.reduce((n, m) => n + m.columns.length, 0);
    lines.push(`  ${count} missing column(s):`);
    for (const m of report.missingColumns) {
      lines.push(`    - ${m.table}: ${m.columns.join(", ")}`);
    }
  }
  // Per-Cause Remediation — `kumiko schema apply` löst NUR pending. Checksum-
  // mismatch ist eine Sackgasse für apply (MigrationChecksumMismatchError) und
  // baseline (ON CONFLICT DO NOTHING → landet in alreadyTracked). Missing
  // tables ohne pending = manuell gelöschte Tabelle nach apply → ebenfalls
  // nicht durch apply heilbar.
  lines.push("");
  if (report.pending.length > 0) {
    lines.push("Run 'kumiko schema apply' to apply the pending migration(s).");
  }
  if (report.checksumMismatches.length > 0) {
    lines.push("Revert the edited migration file(s) to their applied content, or hand-correct");
    lines.push("the checksum in _kumiko_migrations — 'kumiko schema apply' cannot resolve a");
    lines.push("checksum mismatch.");
  }
  if (report.missingTables.length > 0 && report.pending.length === 0) {
    lines.push("Missing table(s) without pending migration(s) — table was dropped after apply.");
    lines.push("Restore from backup, or generate a new migration that re-creates the table.");
  }
  if (report.missingColumns.length > 0) {
    lines.push("Missing column(s) — the live table predates a richer snapshot (e.g. a");
    lines.push("ride-along column the generator now emits). Run 'kumiko schema generate' to");
    lines.push(
      "produce an ALTER-TABLE migration for the new column(s), then 'kumiko schema apply'.",
    );
  }
  return lines.join("\n");
}

/** Throws SchemaDriftError with a human-readable message when the DB is not
 *  current with the checked-in kumiko/migrations. */
export async function assertKumikoSchemaCurrent(
  db: DbConnection,
  migrationsDir: string,
): Promise<void> {
  const report = await detectKumikoDrift(db, migrationsDir);
  if (!report.ok) throw new SchemaDriftError(formatKumikoDriftReport(report), report);
}
