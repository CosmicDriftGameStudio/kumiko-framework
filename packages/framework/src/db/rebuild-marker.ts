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

import { managedChangeRequiresRecreate, type SchemaDiff } from "./migrate-generator";

const MARKER_VERSION = 1 as const;

type RebuildMarker = {
  readonly version: typeof MARKER_VERSION;
  readonly tables: readonly string[];
};

function markerPathFor(migrationsDir: string, migrationId: string): string {
  return join(migrationsDir, `${migrationId}.rebuild.json`);
}

// Only managed tables (event-stream derivatives) get rebuild markers — unmanaged
// carry real data, never rebuilt from events; sorted+deduped for stable PR diff.
//
// A changed table needs a rebuild ONLY when the generated SQL RECREATES it
// (managedChangeRequiresRecreate: drop/NOT-NULL-w/o-default/unique-index/type-
// or nullability-change) — then the table is emptied and must be re-derived from
// events. A pure additive nullable column is an in-place `ADD COLUMN` ALTER that
// already brings the table to the target state (same logic #181 applied to
// index-/default-only changes). Rebuilding it anyway is wasted replay AND — the
// bug this closes — a co-triggered rebuild can drop the fresh column (rebuild
// runs from the rebuilding process's registry meta; on a rolling deploy an older
// pod's meta lacks the column → shadow-swap wipes it → phantom migration + boot-
// drift crash; see 0008_add_pending_deletion_request_id / #494 / #835).
//
// If a NEW additive column genuinely needs value-backfill from historical events
// (a column DERIVED from existing event fields), opt in explicitly by hand-adding
// a `NNNN_<name>.rebuild.json` next to the migration (readRebuildMarker reads it).
export function rebuildTablesFromDiff(diff: SchemaDiff): readonly string[] {
  const names = new Set<string>();
  for (const t of diff.changedTables) {
    if (t.nextMeta.source !== "managed") continue;
    if (managedChangeRequiresRecreate(t)) names.add(t.tableName);
  }
  for (const t of diff.newTables) {
    if (t.source === "managed") names.add(t.tableName);
  }
  return [...names].sort();
}

// Schreibt `<sqlFilename ohne .sql>.rebuild.json`. Leere Tabellen-Liste →
// kein Marker (z.B. reine Drop-Migration).
export function writeRebuildMarker(
  migrationsDir: string,
  sqlFilename: string,
  tables: readonly string[],
): void {
  // skip: leere Tabellen-Liste → kein Marker (z.B. reine Drop-Migration).
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
