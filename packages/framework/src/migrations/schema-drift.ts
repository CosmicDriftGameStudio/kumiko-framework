// Schema-Drift-Detection für den Boot-Gate und die migrate-validate-CLI.
//
// Vergleicht den Drizzle-Migrations-Stand (committed im Repo unter
// drizzle/migrations/meta/) mit dem aktuellen DB-Stand. Drei Schichten:
//
//   1. Journal-vs-Applied: jeder Eintrag im _journal.json muss eine Zeile
//      in __drizzle_migrations haben (= migrate apply lief vollständig).
//   2. Tables-Exist: jede Tabelle aus dem letzten Snapshot existiert.
//   3. (Welle 2) Column-Diff: information_schema-Vergleich gegen Snapshot
//      Spalten-Definitionen. NICHT in dieser Iteration — Hooks vorhanden.
//
// Drizzle-kit's eigene Garantie: nach `migrate apply` ist der DB-Stand
// strukturell identisch mit dem letzten Snapshot. Manueller ALTER TABLE
// in Prod wird von (1)+(2) NICHT erkannt — das ist Welle 2. Für die
// häufigste Fehler-Klasse (CI hat migrate apply vergessen, Container
// startet auf nicht-migrierter DB) reicht (1)+(2) vollständig.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import type { DbConnection } from "../db/connection";
import { tableExists } from "../db/schema-inspection";

// --- Journal & Snapshot Loader ---

export type JournalEntry = {
  readonly idx: number;
  readonly version: string;
  readonly when: number;
  readonly tag: string;
  readonly breakpoints: boolean;
};

export type Journal = {
  readonly version: string;
  readonly dialect: string;
  readonly entries: readonly JournalEntry[];
};

export function loadJournal(migrationsDir: string): Journal {
  const journalPath = resolve(migrationsDir, "meta/_journal.json");
  return JSON.parse(readFileSync(journalPath, "utf-8")) as Journal;
}

/** Drizzle-Snapshot-Format. Wir nutzen nur die Tabellen-Liste — der
 *  Rest (columns, indexes, foreignKeys, …) bleibt opaque für Welle 2. */
export type DrizzleSnapshot = {
  readonly tables: Readonly<Record<string, { readonly schema: string; readonly name: string }>>;
};

export function loadLatestSnapshot(migrationsDir: string): DrizzleSnapshot {
  const journal = loadJournal(migrationsDir);
  const latest = journal.entries[journal.entries.length - 1];
  if (!latest) {
    throw new Error(
      `loadLatestSnapshot: no entries in ${resolve(migrationsDir, "meta/_journal.json")}. ` +
        `Run 'yarn kumiko migrate generate' first.`,
    );
  }
  const snapshotFile = `${String(latest.idx).padStart(4, "0")}_snapshot.json`;
  const snapshotPath = resolve(migrationsDir, "meta", snapshotFile);
  return JSON.parse(readFileSync(snapshotPath, "utf-8")) as DrizzleSnapshot;
}

// --- DB-State Inspector ---

export type AppliedMigration = {
  readonly hash: string;
  readonly createdAt: number;
};

/** Liest die `__drizzle_migrations`-Tabelle. Wenn sie nicht existiert
 *  (frische DB, niemand hat bisher migrate apply gefahren) → leeres
 *  Array. Caller soll daraus "alle pending"-Drift ableiten. */
export async function loadAppliedMigrations(db: DbConnection): Promise<AppliedMigration[]> {
  const exists = await tableExists(db, "drizzle.__drizzle_migrations");
  if (!exists) {
    // Drizzle-kit speichert in `drizzle.__drizzle_migrations` (eigenes Schema).
    // Fallback: alte Versionen schreiben in public.__drizzle_migrations.
    const publicExists = await tableExists(db, "public.__drizzle_migrations");
    if (!publicExists) return [];
  }
  const rows = await db.execute<{ hash: string; created_at: bigint | number | null }>(sql`
    SELECT hash, created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY id
  `);
  return rows.map((r) => ({
    hash: r.hash,
    createdAt: typeof r.created_at === "bigint" ? Number(r.created_at) : (r.created_at ?? 0),
  }));
}

// --- Drift Report ---

export type DriftReport = {
  readonly ok: boolean;
  readonly pendingMigrations: readonly JournalEntry[];
  readonly missingTables: readonly string[];
};

export async function detectDrift(
  db: DbConnection,
  migrationsDir: string,
): Promise<DriftReport> {
  const journal = loadJournal(migrationsDir);
  const applied = await loadAppliedMigrations(db);

  // Heuristik: Drizzle's `__drizzle_migrations` enthält keine Reihenfolge-
  // Information die direkt zu journal.tag matched. Praktisch: nach jeder
  // erfolgreichen `migrate apply` ist applied.length === entries.length.
  // Wenn Count abweicht → pending.
  const pendingMigrations =
    applied.length < journal.entries.length
      ? journal.entries.slice(applied.length)
      : [];

  const snapshot = loadLatestSnapshot(migrationsDir);
  const expectedTables = Object.values(snapshot.tables).map((t) => `${t.schema}.${t.name}`);
  const exists = await Promise.all(expectedTables.map((q) => tableExists(db, q)));
  const missingTables = expectedTables.filter((_, i) => !exists[i]);

  return {
    ok: pendingMigrations.length === 0 && missingTables.length === 0,
    pendingMigrations,
    missingTables,
  };
}

export function formatDriftReport(report: DriftReport): string {
  if (report.ok) return "Schema is current.";
  const lines: string[] = ["Schema drift detected:"];
  if (report.pendingMigrations.length > 0) {
    lines.push(`  ${report.pendingMigrations.length} unapplied migration(s):`);
    for (const m of report.pendingMigrations) {
      lines.push(`    - ${m.tag}`);
    }
  }
  if (report.missingTables.length > 0) {
    lines.push(`  ${report.missingTables.length} missing table(s):`);
    for (const t of report.missingTables) {
      lines.push(`    - ${t}`);
    }
  }
  lines.push("");
  lines.push("Run 'yarn kumiko migrate apply' to bring the DB up-to-date.");
  return lines.join("\n");
}

/** Throws SchemaDriftError mit human-readable message wenn Drift. */
export async function assertSchemaCurrent(
  db: DbConnection,
  migrationsDir: string,
): Promise<void> {
  const report = await detectDrift(db, migrationsDir);
  if (!report.ok) throw new SchemaDriftError(formatDriftReport(report), report);
}

export class SchemaDriftError extends Error {
  readonly report: DriftReport;
  constructor(message: string, report: DriftReport) {
    super(message);
    this.name = "SchemaDriftError";
    this.report = report;
  }
}
