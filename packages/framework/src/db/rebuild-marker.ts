// Rebuild-Marker für den drizzle-freien Migrations-Pfad.
//
// `kumiko schema generate` schreibt neben jedes `NNNN_<name>.sql` einen
// Sibling-Marker `NNNN_<name>.rebuild.json`, der die in dieser Migration
// geänderten/neu angelegten Tabellen listet. `kumiko schema apply` liest den
// Marker für jede frisch applizierte Migration und rebuildet die betroffenen
// Projektionen.
//
// Bewusst nur **Tabellennamen** (kein Projection-Name): der Generator ist
// registry-frei (kennt die App-Projektionen nicht). Die Auflösung
// Tabelle→Projection passiert app-seitig beim Apply via
// `buildProjectionTableIndex(registry)`. Tabellen ohne zugehörige Projektion
// werden dort einfach übersprungen.
//
// Marker werden zum generate-Zeitpunkt aus dem strukturierten `SchemaDiff`
// geschrieben — nicht beim Apply aus dem (ggf. hand-editierten) SQL
// re-derived.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { SchemaDiff } from "./migrate-generator";

const MARKER_VERSION = 1 as const;

type RebuildMarker = {
  readonly version: typeof MARKER_VERSION;
  readonly tables: readonly string[];
};

function markerPathFor(migrationsDir: string, migrationId: string): string {
  return join(migrationsDir, `${migrationId}.rebuild.json`);
}

// Tabellen die nach dieser Migration einen Projection-Rebuild brauchen können:
// neu angelegte + Tabellen mit neuer Spalte. Index-/Nullability-/Default-/
// Drop-only-Änderungen brauchen KEINEN Rebuild — das generierte ALTER-SQL
// bringt die Tabelle alleine in den Soll-Zustand. Über-Rebuild ist safe-but-
// wasteful (Tabellen-Lock + Full-Replay auf grossen Streams), deshalb hier
// konservativ einschränken. Sortiert + dedupliziert für stabilen PR-Diff.
export function rebuildTablesFromDiff(diff: SchemaDiff): readonly string[] {
  const names = new Set<string>();
  for (const t of diff.changedTables) {
    if (t.newColumns.length > 0) names.add(t.tableName);
  }
  for (const t of diff.newTables) names.add(t.tableName);
  return [...names].sort();
}

// Schreibt `<sqlFilename ohne .sql>.rebuild.json`. Leere Tabellen-Liste →
// kein Marker (z.B. reine Drop-Migration).
export function writeRebuildMarker(
  migrationsDir: string,
  sqlFilename: string,
  tables: readonly string[],
): void {
  if (tables.length === 0) return;
  const migrationId = sqlFilename.replace(/\.sql$/, "");
  const marker: RebuildMarker = { version: MARKER_VERSION, tables };
  writeFileSync(markerPathFor(migrationsDir, migrationId), `${JSON.stringify(marker, null, 2)}\n`);
}

// Liest die Tabellen-Liste für eine applizierte Migration. Kein Marker /
// kaputtes File → leere Liste (Migration ohne Projection-Impact).
export function readRebuildMarker(migrationsDir: string, migrationId: string): readonly string[] {
  const path = markerPathFor(migrationsDir, migrationId);
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  if (!("version" in parsed) || parsed.version !== MARKER_VERSION) return [];
  if (!("tables" in parsed)) return [];
  const { tables } = parsed;
  if (!Array.isArray(tables)) return [];
  return tables.filter((t): t is string => typeof t === "string");
}
