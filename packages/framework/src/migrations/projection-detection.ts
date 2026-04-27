// Snapshot-Diff + Projection-Lookup für die Welle-2-Migration-Pipeline.
//
// Wenn `kumiko migrate generate` ein neues Drizzle-Snapshot-File erzeugt,
// vergleichen wir es mit dem vorherigen. Tabellen die schema-changes
// haben (Spalten dazu/weg, Spalten-Type-Änderung) sind Kandidaten für
// einen Projection-Rebuild — vorausgesetzt sie gehören zu einer
// registrierten Projection.
//
// Der Lookup geht über getTableName(projection.table) — die Drizzle-
// public-API für den physischen Tabellen-Namen einer pgTable-Definition.
// Damit muss niemand Tabellen-Namen doppelt pflegen (Truth liegt in der
// Projection-Definition).

import { getTableName } from "drizzle-orm";
import type { Registry } from "../engine/types/feature";
import { loadJournal, type DrizzleSnapshot } from "./schema-drift";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Bundle Snapshot mit Tabellen-spezifischen Spalten-Maps. Wir lesen
 *  nur die Felder die wir vergleichen — der Rest bleibt opaque. */
export type DetailedSnapshot = {
  readonly tables: Readonly<
    Record<
      string,
      {
        readonly schema: string;
        readonly name: string;
        readonly columns: Readonly<Record<string, ColumnSpec>>;
      }
    >
  >;
};

export type ColumnSpec = {
  readonly name: string;
  readonly type: string;
  readonly notNull?: boolean;
  readonly primaryKey?: boolean;
  readonly default?: unknown;
};

export function loadDetailedSnapshot(snapshotPath: string): DetailedSnapshot {
  return JSON.parse(readFileSync(snapshotPath, "utf-8")) as DetailedSnapshot;
}

/** Welche Tabellen haben sich zwischen prev und current geändert?
 *  Reine Tabellen-Existenz: in current aber nicht in prev → "added".
 *  Spalten-Veränderungen: identische Tabelle aber Spalten unterscheiden. */
export type ChangedTable = {
  readonly fullName: string; // "schema.name" oder einfach "name" wenn empty schema
  readonly tableName: string; // nur "name" für tableName-Lookup
  readonly kind: "added" | "modified" | "removed";
};

export function compareSnapshots(
  prev: DetailedSnapshot | null,
  current: DetailedSnapshot,
): readonly ChangedTable[] {
  const changes: ChangedTable[] = [];
  const prevKeys = new Set(prev ? Object.keys(prev.tables) : []);
  const currentKeys = new Set(Object.keys(current.tables));

  for (const key of currentKeys) {
    const cur = current.tables[key];
    if (!cur) continue;
    const fullName = cur.schema && cur.schema.length > 0 ? `${cur.schema}.${cur.name}` : cur.name;
    if (!prevKeys.has(key)) {
      changes.push({ fullName, tableName: cur.name, kind: "added" });
      continue;
    }
    const prevTable = prev?.tables[key];
    if (!prevTable) continue;
    if (!sameColumns(prevTable.columns, cur.columns)) {
      changes.push({ fullName, tableName: cur.name, kind: "modified" });
    }
  }

  for (const key of prevKeys) {
    if (!currentKeys.has(key)) {
      const prevTable = prev?.tables[key];
      if (!prevTable) continue;
      const fullName =
        prevTable.schema && prevTable.schema.length > 0
          ? `${prevTable.schema}.${prevTable.name}`
          : prevTable.name;
      changes.push({ fullName, tableName: prevTable.name, kind: "removed" });
    }
  }

  return changes;
}

function sameColumns(
  a: Readonly<Record<string, ColumnSpec>>,
  b: Readonly<Record<string, ColumnSpec>>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const colA = a[key];
    const colB = b[key];
    if (!colA || !colB) return false;
    if (colA.name !== colB.name) return false;
    if (colA.type !== colB.type) return false;
    if (Boolean(colA.notNull) !== Boolean(colB.notNull)) return false;
    if (Boolean(colA.primaryKey) !== Boolean(colB.primaryKey)) return false;
    // Default-Vergleich bewusst per JSON — Drizzle serialisiert default-
    // expressions als String, das passt für CREATE TABLE-Zwecke.
    if (JSON.stringify(colA.default) !== JSON.stringify(colB.default)) return false;
  }
  return true;
}

/** Index `tableName → projection-name` aus der Registry. Nur Projections
 *  mit table-Definition (single-stream + multi-stream-with-table) zählen.
 *  Side-effect-only MSPs (table omitted) haben keinen Rebuild-Sinn. */
export function buildProjectionTableIndex(registry: Registry): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const [name, def] of registry.getAllProjections()) {
    index.set(getTableName(def.table), name);
  }
  for (const [name, def] of registry.getAllMultiStreamProjections()) {
    if (def.table) index.set(getTableName(def.table), name);
  }
  return index;
}

/** Aus einer Liste geänderter Tabellen die Projection-Namen extrahieren.
 *  "removed" ignoriert: gelöschte Projection-Tabellen → die Projection
 *  ist auch weg, kein Rebuild-Bedarf. "added" wird zurückgegeben — beim
 *  ersten Migrate aus einer leeren DB sind das keine echten Rebuilds
 *  (keine historischen Events), aber der Apply-Step filtert das selbst
 *  über event-count > 0 heraus. */
export function projectionsFromChanges(
  changes: readonly ChangedTable[],
  index: ReadonlyMap<string, string>,
): readonly string[] {
  const names = new Set<string>();
  for (const change of changes) {
    if (change.kind === "removed") continue;
    const projection = index.get(change.tableName);
    if (projection) names.add(projection);
  }
  return [...names].sort();
}

/** Hilfs-Funktion: lade vorletzten Snapshot relativ zum letzten Eintrag.
 *  Returns null wenn das gerade die erste Migration ist. */
export function loadPreviousSnapshot(migrationsDir: string): DetailedSnapshot | null {
  const journal = loadJournal(migrationsDir);
  const entries = journal.entries;
  if (entries.length < 2) return null;
  const prevEntry = entries[entries.length - 2];
  if (!prevEntry) return null;
  const file = `${String(prevEntry.idx).padStart(4, "0")}_snapshot.json`;
  return loadDetailedSnapshot(resolve(migrationsDir, "meta", file));
}

export function loadCurrentSnapshot(migrationsDir: string): DetailedSnapshot {
  const journal = loadJournal(migrationsDir);
  const entries = journal.entries;
  if (entries.length === 0) {
    throw new Error(`loadCurrentSnapshot: no migrations in ${migrationsDir}`);
  }
  const last = entries[entries.length - 1];
  if (!last) throw new Error(`loadCurrentSnapshot: empty journal`);
  const file = `${String(last.idx).padStart(4, "0")}_snapshot.json`;
  return loadDetailedSnapshot(resolve(migrationsDir, "meta", file));
}

/** Convenience: gibt für die letzte Migration zurück welche Projections
 *  rebuild brauchen würden. null = erste Migration (kein vorheriger
 *  Snapshot, alle Tabellen "added"). */
export function detectProjectionsToRebuild(
  registry: Registry,
  migrationsDir: string,
): readonly string[] {
  const prev = loadPreviousSnapshot(migrationsDir);
  const current = loadCurrentSnapshot(migrationsDir);
  const changes = compareSnapshots(prev, current);
  // Initial migration: keine prev-Tabellen → alle "added". Skip rebuild
  // für additive Erstmigration (Projection-Tabelle gerade entstanden,
  // Events sind noch nicht da).
  if (prev === null) return [];
  const index = buildProjectionTableIndex(registry);
  return projectionsFromChanges(changes, index);
}

/** Tag des letzten journal-Eintrags — nutzen wir als Marker-File-Name. */
export function latestMigrationTag(migrationsDir: string): string {
  const journal = loadJournal(migrationsDir);
  const last = journal.entries[journal.entries.length - 1];
  if (!last) throw new Error(`latestMigrationTag: empty journal in ${migrationsDir}`);
  return last.tag;
}
