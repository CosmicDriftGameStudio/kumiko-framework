// Index `tableName → projection-name` aus der Registry. Genutzt vom
// app-seitigen Projection-Rebuild (`kumiko schema apply` liest die
// rebuild-Marker → mappt Tabellen auf Projektionen → rebuildProjection).
//
// Drizzle-frei: der Tabellen-Name kommt aus dem kumiko-Symbol das
// buildEntityTable/buildEntityTableMeta an die Table-Definition hängt.

import type { Registry } from "../engine/types/feature";

const KUMIKO_NAME_SYMBOL = Symbol.for("kumiko:schema:Name");

function getTableName(table: unknown): string {
  if (typeof table !== "object" || table === null) {
    throw new Error("projection-table-index: table is not a table object");
  }
  const name = (table as Record<symbol, unknown>)[KUMIKO_NAME_SYMBOL];
  if (typeof name !== "string") {
    throw new Error("projection-table-index: table missing kumiko name symbol");
  }
  return name;
}

/** Index `tableName → projection-name` aus der Registry. Nur Projections mit
 *  table-Definition (single-stream + multi-stream-with-table) zählen.
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
