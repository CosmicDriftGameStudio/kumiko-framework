// Rebuild marker for the drizzle-free migration path.
//
// `kumiko schema generate` writes a sibling marker
// `NNNN_<name>.rebuild.json` next to each `NNNN_<name>.sql`, listing the tables
// changed or created by that migration. `kumiko schema apply` reads the marker
// for each newly applied migration and rebuilds the affected projections.
//
// Deliberately stores only **table names** (not projection names): the generator
// is registry-free and does not know the app's projections. The table-to-
// projection resolution happens in the app during apply via
// `buildProjectionTableIndex(registry)`. Tables without a corresponding
// projection are simply skipped there.
//
// Markers are written at generate time from the structured `SchemaDiff`, rather
// than being re-derived during apply from the possibly hand-edited SQL.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { managedChangeRequiresRecreate, type SchemaDiff } from "./migrate-generator.ts";

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
// already brings the table to the target state (same logic applied to
// index-/default-only changes). Rebuilding it anyway is wasted replay AND — the
// bug this closes — a co-triggered rebuild can drop the fresh column (rebuild
// runs from the rebuilding process's registry meta; on a rolling deploy an older
// pod's meta lacks the column → shadow-swap wipes it → phantom migration + boot-
// drift crash).
//
// If a NEW additive column genuinely needs value-backfill from historical events
// (a column DERIVED from existing event fields), opt in explicitly by hand-adding
// a `NNNN_<name>.rebuild.json` next to the migration (readRebuildMarker reads it).
//
// One built-in exception to the additive-column rule: a new `_bidx` column
// (blind-index for a field that just became `lookupable: true`, naming
// convention `${snake}_bidx` from entity-table-meta.ts:111) is always
// additive SQL-wise but still needs a rebuild — the index is an HMAC over
// the decrypted value, which SQL cannot backfill.
export function rebuildTablesFromDiff(diff: SchemaDiff): readonly string[] {
  const names = new Set<string>();
  for (const t of diff.changedTables) {
    if (t.nextMeta.source !== "managed") continue;
    if (managedChangeRequiresRecreate(t) || t.newColumns.some((c) => c.name.endsWith("_bidx"))) {
      names.add(t.tableName);
    }
  }
  for (const t of diff.newTables) {
    if (t.source === "managed") names.add(t.tableName);
  }
  return [...names].sort();
}

// Writes `<sqlFilename without .sql>.rebuild.json`. An empty table list writes no
// marker (for example, a drop-only migration).
export function writeRebuildMarker(
  migrationsDir: string,
  sqlFilename: string,
  tables: readonly string[],
): void {
  // skip: empty table list means no marker is written (for example, for a
  // migration that only drops tables).
  if (tables.length === 0) return;
  const migrationId = sqlFilename.replace(/\.sql$/, "");
  const marker: RebuildMarker = { version: MARKER_VERSION, tables };
  writeFileSync(markerPathFor(migrationsDir, migrationId), `${JSON.stringify(marker, null, 2)}\n`);
}

// Reads the table list for an applied migration. A missing or malformed file
// yields an empty list (the migration has no projection impact).
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
