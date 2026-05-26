// Drizzle-free schema-drift gate for the `kumiko/migrations` system.
//
// Replaces the drizzle-journal gate (schema-drift.ts). Validates two layers
// against the checked-in artifacts:
//
//   1. Migrations applied: every `kumiko/migrations/*.sql` has a row in
//      `_kumiko_migrations`. Applied-but-edited (checksum mismatch) is drift.
//   2. Tables exist: every table in `kumiko/migrations/.snapshot.json` exists.
//
// Contract (unchanged from the legacy gate): boot VALIDATES only, never
// applies. Apply is the deploy-step `kumiko schema apply` (runMigrationsFromDir).
//
// Layer 3 (column-diff against the snapshot's ColumnMeta — catches manual
// ALTERs / stale defs) is a documented follow-up; see
// docs/plans/migration-system-consolidation.md.

import { join } from "node:path";
import type { DbConnection } from "../db/connection";
import { loadSnapshotJson } from "../db/migrate-generator";
import { fetchAppliedMigrations, loadMigrationsFromDir } from "../db/migrate-runner";
import { tableExists } from "../db/schema-inspection";

const SNAPSHOT_FILENAME = ".snapshot.json";

export type ChecksumMismatch = {
  readonly id: string;
  readonly expected: string; // checksum recorded in _kumiko_migrations
  readonly actual: string; // checksum of the file on disk now
};

export type KumikoDriftReport = {
  readonly ok: boolean;
  readonly pending: readonly string[];
  readonly checksumMismatches: readonly ChecksumMismatch[];
  readonly missingTables: readonly string[];
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
  if (snapshot) {
    const checks = await Promise.all(
      snapshot.tables.map((t) =>
        tableExists(db, t.tableName).then((exists) => ({ name: t.tableName, exists })),
      ),
    );
    for (const c of checks) if (!c.exists) missingTables.push(c.name);
  }

  return {
    ok: pending.length === 0 && checksumMismatches.length === 0 && missingTables.length === 0,
    pending,
    checksumMismatches,
    missingTables,
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
  lines.push("");
  lines.push("Run 'kumiko schema apply' to bring the DB up-to-date.");
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
