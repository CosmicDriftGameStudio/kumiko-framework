// Schema-Drift-Detection für den Boot-Gate und die migrate-validate-CLI.
//
// Vergleicht den Drizzle-Migrations-Stand (committed im Repo unter
// drizzle/migrations/meta/) mit dem aktuellen DB-Stand. Drei Schichten:
//
//   1. Journal-vs-Applied: jeder Eintrag im _journal.json muss eine Zeile
//      in __drizzle_migrations haben (= migrate apply lief vollständig).
//   2. Tables-Exist: jede Tabelle aus dem letzten Snapshot existiert.
//   3. Column-Diff: information_schema-Vergleich gegen Snapshot —
//      missing-/extra-column, type-mismatch, nullability-mismatch. Fängt
//      manuelle ALTER TABLEs in Prod sowie doppelte pgTable-Definitionen
//      pro Tabelle (eine hand-written, eine via buildEntityTable), die
//      stillschweigend gegen den Snapshot driften.
//
// Drizzle-kit's eigene Garantie: nach `migrate apply` ist der DB-Stand
// strukturell identisch mit dem letzten Snapshot. Schicht 3 catched
// alles was diese Garantie nachträglich bricht — schreibender Drittsystem,
// veraltete Code-Definitionen, vergessenes generate.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DbConnection } from "../db/connection";
import type { DbConnection } from "../db/connection";
import { selectAppliedMigrations, selectPublicTableColumns } from "../db/queries/schema-drift";
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
  const rows = await selectAppliedMigrations(
    db,
    drizzleSchemaExists ? "drizzle.__drizzle_migrations" : "public.__drizzle_migrations",
  );
  return rows.map((r) => ({
    hash: r.hash,
    createdAt: typeof r.created_at === "bigint" ? Number(r.created_at) : (r.created_at ?? 0),
  }));
}

// --- Column-Diff (Welle 2 Boot-Gate Layer 3) ---

/** Liest information_schema.columns für eine Tabelle im public-Schema.
 *  Map by column_name. Default-Werte werden bewusst ausgelassen — die
 *  drift'en über drizzle-Versionen / PG-Reformulierungen hinweg ohne dass
 *  sich faktisch was ändert (z.B. `now()` vs `CURRENT_TIMESTAMP`). Type +
 *  notNull sind die belastbaren Vergleichs-Felder. */
async function loadDbColumns(
  db: DbConnection,
  tableName: string,
): Promise<ReadonlyMap<string, { type: string; notNull: boolean }>> {
  const rows = await selectPublicTableColumns(db, tableName);
  const map = new Map<string, { type: string; notNull: boolean }>();
  for (const r of rows) {
    map.set(r.column_name, {
      type: normalizePgType(r.data_type),
      notNull: r.is_nullable === "NO",
    });
  }
  return map;
}

/** Normalize PG type-Strings auf Drizzle-Snapshot-Konvention. PG meldet
 *  "timestamp with time zone" für TIMESTAMPTZ, "character varying" für
 *  VARCHAR — Drizzle schreibt "timestamp with time zone" / "varchar" im
 *  Snapshot. Wir kollabieren auf einen kanonischen String. */
function normalizePgType(pgType: string): string {
  switch (pgType) {
    case "timestamp with time zone":
      return "timestamp with time zone";
    case "character varying":
      return "varchar";
    case "double precision":
      return "double precision";
    case "USER-DEFINED":
      // Custom-types wie enums — kein clean diff möglich, akzeptieren wir
      // als "irgendwas" und überspringen die Type-Prüfung.
      return "USER-DEFINED";
    default:
      return pgType;
  }
}

function normalizeSnapshotType(snapshotType: string): string {
  // PostgreSQL meldet im information_schema kanonisierte data_type-Strings,
  // Drizzle's snapshot kann mehrere äquivalente Schreibweisen produzieren:
  //
  //   timestamptz                      → "timestamp with time zone"
  //   timestamp(3) with time zone      → "timestamp with time zone"
  //   timestamp without time zone      → unverändert
  //   bigserial                        → "bigint"  (serial ist Macro für sequence + bigint)
  //   serial                           → "integer"
  //   smallserial                      → "smallint"
  //   varchar(N)                       → "character varying"
  //
  // Ohne diese Normalisierung produziert Layer-3 false-positives weil DB
  // und Snapshot semantisch dieselbe Spalte unterschiedlich schreiben.
  const lower = snapshotType.toLowerCase().replace(/\s+/g, " ").trim();
  if (lower === "timestamptz" || lower.match(/^timestamp\(\d+\) with time zone$/)) {
    return "timestamp with time zone";
  }
  if (lower === "bigserial") return "bigint";
  if (lower === "serial") return "integer";
  if (lower === "smallserial") return "smallint";
  if (lower.startsWith("varchar")) return "character varying";
  return lower;
}

/** Eine Differenz zwischen erwarteter (Snapshot) und tatsächlicher (DB)
 *  Spalten-Definition. */
export type ColumnIssue =
  | { readonly kind: "missing-column"; readonly table: string; readonly column: string }
  | { readonly kind: "extra-column"; readonly table: string; readonly column: string }
  | {
      readonly kind: "type-mismatch";
      readonly table: string;
      readonly column: string;
      readonly expected: string;
      readonly actual: string;
    }
  | {
      readonly kind: "nullability-mismatch";
      readonly table: string;
      readonly column: string;
      readonly expectedNotNull: boolean;
      readonly actualNotNull: boolean;
    };

async function detectColumnIssues(
  db: DbConnection,
  snapshot: Snapshot,
  existingTables: readonly string[],
): Promise<readonly ColumnIssue[]> {
  const issues: ColumnIssue[] = [];
  const existingSet = new Set(existingTables);
  for (const t of Object.values(snapshot.tables)) {
    const fullName = t.schema && t.schema.length > 0 ? `${t.schema}.${t.name}` : t.name;
    if (!existingSet.has(fullName)) continue; // missing-table-Layer hat das schon
    const dbCols = await loadDbColumns(db, t.name);
    const snapCols = t.columns;
    // Spalten die im Snapshot stehen, aber nicht in der DB sind.
    for (const snapCol of Object.values(snapCols)) {
      const dbCol = dbCols.get(snapCol.name);
      if (!dbCol) {
        issues.push({ kind: "missing-column", table: t.name, column: snapCol.name });
        continue;
      }
      const expectedType = normalizeSnapshotType(snapCol.type);
      // USER-DEFINED ist die PG-Antwort für enums — type-Vergleich wäre
      // unzuverlässig (PG meldet keinen Enum-Namen über data_type). Skip.
      if (dbCol.type !== "USER-DEFINED" && dbCol.type !== expectedType) {
        issues.push({
          kind: "type-mismatch",
          table: t.name,
          column: snapCol.name,
          expected: expectedType,
          actual: dbCol.type,
        });
      }
      const expectedNotNull = snapCol.notNull === true || snapCol.primaryKey === true;
      if (dbCol.notNull !== expectedNotNull) {
        issues.push({
          kind: "nullability-mismatch",
          table: t.name,
          column: snapCol.name,
          expectedNotNull,
          actualNotNull: dbCol.notNull,
        });
      }
    }
    // Spalten die in der DB sind, aber nicht im Snapshot — vermutlich
    // manueller ALTER TABLE in Prod. Reportet als extra-column.
    const snapDbNames = new Set(Object.values(snapCols).map((c) => c.name));
    for (const dbColName of dbCols.keys()) {
      if (!snapDbNames.has(dbColName)) {
        issues.push({ kind: "extra-column", table: t.name, column: dbColName });
      }
    }
  }
  return issues;
}

// --- Drift Report ---

export type DriftReport = {
  readonly ok: boolean;
  readonly pendingMigrations: readonly JournalEntry[];
  readonly missingTables: readonly string[];
  readonly columnIssues: readonly ColumnIssue[];
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
  const existingTables = expectedTables.filter((_, i) => exists[i]);

  // Layer 3: Column-Diff für die Tables die existieren. Pending Migrations
  // skippen wir — die DB ist ohnehin in einem Zwischenzustand.
  const columnIssues =
    pendingMigrations.length === 0 ? await detectColumnIssues(db, snapshot, existingTables) : [];

  return {
    ok: pendingMigrations.length === 0 && missingTables.length === 0 && columnIssues.length === 0,
    pendingMigrations,
    missingTables,
    columnIssues,
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
  if (report.columnIssues.length > 0) {
    lines.push(`  ${report.columnIssues.length} column issue(s):`);
    for (const issue of report.columnIssues) {
      switch (issue.kind) {
        case "missing-column":
          lines.push(`    - ${issue.table}.${issue.column}: missing in DB`);
          break;
        case "extra-column":
          lines.push(`    - ${issue.table}.${issue.column}: not in snapshot`);
          break;
        case "type-mismatch":
          lines.push(
            `    - ${issue.table}.${issue.column}: type ${issue.actual} (expected ${issue.expected})`,
          );
          break;
        case "nullability-mismatch":
          lines.push(
            `    - ${issue.table}.${issue.column}: nullable=${!issue.actualNotNull} (expected nullable=${!issue.expectedNotNull})`,
          );
          break;
      }
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
