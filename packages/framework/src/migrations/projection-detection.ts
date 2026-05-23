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

import type { Registry } from "../engine/types/feature";
import {
  type ColumnSpec,
  loadJournal,
  loadLatestSnapshot,
  loadPreviousSnapshot,
  type Snapshot,
} from "./schema-drift";

/** Welche Tabellen haben sich zwischen prev und current geändert?
 *  Reine Tabellen-Existenz: in current aber nicht in prev → "added".
 *  Spalten-Veränderungen: identische Tabelle aber Spalten unterscheiden. */
export type ChangedTable = {
  readonly fullName: string; // "schema.name" oder einfach "name" wenn empty schema
  readonly tableName: string; // nur "name" für tableName-Lookup
  readonly kind: "added" | "modified" | "removed";
};

export function compareSnapshots(
  prev: Snapshot | null,
  current: Snapshot,
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

const KUMIKO_NAME_SYMBOL = Symbol.for("kumiko:schema:Name");
function getTableName(table: unknown): string {
  if (typeof table !== "object" || table === null) {
    throw new Error("projection-detection: table is not a pgTable object");
  }
  const name = (table as Record<symbol, unknown>)[KUMIKO_NAME_SYMBOL];
  if (typeof name !== "string") {
    throw new Error("projection-detection: table missing drizzle name symbol");
  }
  return name;
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

/** Convenience: gibt für die letzte Migration zurück welche Projections
 *  rebuild brauchen würden. Empty wenn das gerade die erste Migration ist
 *  (kein vorheriger Snapshot, alle Tabellen "added", aber keine Events). */
export function detectProjectionsToRebuild(
  registry: Registry,
  migrationsDir: string,
): readonly string[] {
  const prev = loadPreviousSnapshot(migrationsDir);
  // Initial migration: nur "added"-Changes, keine historischen Events
  // zum Replayen → kein Rebuild nötig.
  if (prev === null) return [];
  const current = loadLatestSnapshot(migrationsDir);
  const changes = compareSnapshots(prev, current);
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
