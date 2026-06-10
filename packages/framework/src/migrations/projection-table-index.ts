// Index `tableName → projection-name` aus der Registry. Genutzt vom
// app-seitigen Projection-Rebuild (`kumiko schema apply` liest die
// rebuild-Marker → mappt Tabellen auf Projektionen → rebuildProjection).
//
// Drizzle-frei: der Tabellen-Name kommt aus dem kumiko-Symbol das
// buildEntityTable/buildEntityTableMeta an die Table-Definition hängt.

import { extractTableName } from "../db";
import type { Registry } from "../engine/types/feature";

/** Index `tableName → projection-name` aus der Registry. Nur Projections mit
 *  table-Definition (single-stream + multi-stream-with-table) zählen.
 *  Side-effect-only MSPs (table omitted) haben keinen Rebuild-Sinn. */
export function buildProjectionTableIndex(registry: Registry): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const [name, def] of registry.getAllProjections()) {
    index.set(extractTableName(def.table, `projection-table-index(${name})`), name);
  }
  for (const [name, def] of registry.getAllMultiStreamProjections()) {
    if (def.table) index.set(extractTableName(def.table, `projection-table-index(${name})`), name);
  }
  return index;
}
