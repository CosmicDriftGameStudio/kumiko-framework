// Index `tableName → projection-name` from the registry, used by the
// app-side projection rebuild (`kumiko schema apply` reads rebuild markers,
// maps tables to projections, then calls rebuildProjection).
//
// Drizzle-free: the table name comes from the kumiko symbol attached to the
// table definition by buildEntityTable/deriveEntityTableMeta.

import { extractTableName } from "../db/index.ts";
import type { Registry } from "../engine/types/feature.ts";

/** Index `tableName → projection-name` from the registry. Only projections with
 *  a table definition (single-stream + multi-stream-with-table) are included.
 *  Side-effect-only MSPs (table omitted) cannot be rebuilt. */
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
