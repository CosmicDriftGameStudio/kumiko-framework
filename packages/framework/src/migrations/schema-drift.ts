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
import { parseJsonOrThrow } from "../utils/safe-json";

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
  return parseJsonOrThrow<Journal>(readFileSync(journalPath, "utf-8"), `journal at ${journalPath}`);
}

/** Drizzle-Snapshot-Format. Eine Type für alle Read-Pfade — der
 *  Boot-Gate liest nur table-name+schema, projection-detection liest
 *  zusätzlich columns. Optional-typed `columns`-Field hält den Loader
 *  monomorph ohne zwei verschiedene Snapshot-Types. */
export type ColumnSpec = {
  readonly name: string;
  readonly type: string;
  readonly notNull?: boolean;
  readonly primaryKey?: boolean;
  readonly default?: unknown;
};

export type SnapshotTable = {
  readonly schema: string;
  readonly name: string;
  readonly columns: Readonly<Record<string, ColumnSpec>>;
};

export type Snapshot = {
  readonly tables: Readonly<Record<string, SnapshotTable>>;
};

export function loadSnapshot(snapshotPath: string): Snapshot {
  return parseJsonOrThrow<Snapshot>(
    readFileSync(snapshotPath, "utf-8"),
    `snapshot at ${snapshotPath}`,
  );
}

function snapshotPathForIdx(migrationsDir: string, idx: number): string {
  return resolve(migrationsDir, "meta", `${String(idx).padStart(4, "0")}_snapshot.json`);
}

/** Letzter Snapshot — der Stand der durch das jüngste Migration-File
 *  beschrieben ist. Wirft wenn das Journal leer ist (App ohne erste
 *  Migration). */
export function loadLatestSnapshot(migrationsDir: string): Snapshot {
  const journal = loadJournal(migrationsDir);
  const latest = journal.entries[journal.entries.length - 1];
  if (!latest) {
    throw new Error(
      `loadLatestSnapshot: no entries in ${resolve(migrationsDir, "meta/_journal.json")}. ` +
        `Run 'yarn kumiko migrate generate' first.`,
    );
  }
  return loadSnapshot(snapshotPathForIdx(migrationsDir, latest.idx));
}

/** Vorletzter Snapshot — für Diff-Operationen. Returns null wenn
 *  weniger als 2 Einträge im Journal (Initial-Migration kann gegen
 *  nichts diff'en). */
export function loadPreviousSnapshot(migrationsDir: string): Snapshot | null {
  const journal = loadJournal(migrationsDir);
  if (journal.entries.length < 2) return null;
  const previous = journal.entries[journal.entries.length - 2];
  if (!previous) return null;
  return loadSnapshot(snapshotPathForIdx(migrationsDir, previous.idx));
}

// --- DB-State Inspector ---

export type AppliedMigration = {
  readonly hash: string;
  readonly createdAt: number;
};

/** Liest die `__drizzle_migrations`-Tabelle. Wenn sie nicht existiert
 *  (frische DB, niemand hat bisher migrate apply gefahren) → leeres
 *  Array. Caller soll daraus "alle pending"-Drift ableiten.
 *
 *  Drizzle-kit aktuell speichert in `drizzle.__drizzle_migrations`
 *  (eigenes Schema), Pre-0.20-Versionen in `public.__drizzle_migrations`.
 *  Wir prüfen beide Pfade und queryen den vorhandenen — keine
 *  hardcoded Schema-Annahme. */
export async function loadAppliedMigrations(db: DbConnection): Promise<AppliedMigration[]> {
  const drizzleSchemaExists = await tableExists(db, "drizzle.__drizzle_migrations");
  const publicSchemaExists = drizzleSchemaExists
    ? false
    : await tableExists(db, "public.__drizzle_migrations");
  if (!drizzleSchemaExists && !publicSchemaExists) return [];
  // sql.identifier mit qualifiziertem Namen: erstes Argument = Schema,
  // zweites = Tabellenname. Drizzle quotet beides defensiv.
  const tableRef = drizzleSchemaExists
    ? sql`drizzle.__drizzle_migrations`
    : sql`public.__drizzle_migrations`;
  const rows = await db.execute<{ hash: string; created_at: bigint | number | null }>(sql`
    SELECT hash, created_at
    FROM ${tableRef}
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

export async function detectDrift(db: DbConnection, migrationsDir: string): Promise<DriftReport> {
  const journal = loadJournal(migrationsDir);
  const applied = await loadAppliedMigrations(db);

  // Heuristik: Drizzle's `__drizzle_migrations` enthält keine Reihenfolge-
  // Information die direkt zu journal.tag matched. Praktisch: nach jeder
  // erfolgreichen `migrate apply` ist applied.length === entries.length.
  // Wenn Count abweicht → pending.
  const pendingMigrations =
    applied.length < journal.entries.length ? journal.entries.slice(applied.length) : [];

  const snapshot = loadLatestSnapshot(migrationsDir);
  // Drizzle's snapshot schreibt `schema: ""` für public — to_regclass
  // ohne Schema-Prefix resolved ebenfalls in public, also passt empty.
  const expectedTables = Object.values(snapshot.tables).map((t) =>
    t.schema && t.schema.length > 0 ? `${t.schema}.${t.name}` : t.name,
  );
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
export async function assertSchemaCurrent(db: DbConnection, migrationsDir: string): Promise<void> {
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
