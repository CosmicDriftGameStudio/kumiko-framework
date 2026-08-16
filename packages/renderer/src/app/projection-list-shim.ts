// Shim für ProjectionList-Renderer (analog action-form-shim.ts / config-edit-shim.ts).
//
// RenderList + computeListViewModel verlangen ein `entity: EntityDefinition` +
// ein `screen: EntityListScreenDefinition`-Pair, nutzen davon aber nur
// `entity.fields` (Spalten-Typ/Label) und die List-Felder des Screens
// (columns/rowActions/…). Ein projectionList-Screen ist query-getrieben und hat
// KEINE Entity — die zwei Helper hier shapen den Input ad-hoc um, damit die
// bestehende List-Maschinerie reused werden kann. Die Query selbst wird NICHT
// hierüber aufgelöst (der Body nimmt `screen.query` direkt).
//
// Selbe Schulden-Reservation wie bei den anderen Shims: greift die List-
// Maschinerie künftig auf weitere EntityDefinition-Felder (transitions, idType,
// derivedFields) oder cross-referenziert ein Boot-Validator die schema.entities-
// Map, brechen die Type-Lies hier silent — dann ist Zeit für eine echte
// query-native ListView-Komponente.

import type {
  EntityDefinition,
  EntityListScreenDefinition,
  ListColumnSpec,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { normalizeListColumn } from "@cosmicdrift/kumiko-framework/ui-types";

const PROJECTION_PSEUDO_ENTITY = "__projection__";

/** Minimal EntityDefinition from the column list: every field is a text
 *  field. `sortable` applies uniformly to all columns — buildAppSchema
 *  derives it from the query's Zod schema (`screen.sortable`, fw#2165); the
 *  query itself has no per-field server-sort guarantee.
 *  computeListViewModel only reads `fields[<col>].type` — text is enough,
 *  presentation comes from the column renderer + explicit label. */
export function synthesizeProjectionEntity(
  columns: readonly ListColumnSpec[],
  sortable: boolean,
): EntityDefinition {
  const fields: Record<string, { type: "text"; sortable: boolean }> = {};
  for (const col of columns) {
    fields[normalizeListColumn(col).field] = { type: "text", sortable };
  }
  return { fields } as unknown as EntityDefinition;
}

/** Wandelt ein ProjectionListScreenDefinition in die EntityListScreen-Shape die
 *  RenderList erwartet. `type` = "entityList" + Pseudo-Entity halten den Type-
 *  Constraint; RenderList branched nicht auf `type` und liest `entity` nur für
 *  Fehlermeldungen. Die List-Felder werden 1:1 durchgereicht. */
export function synthesizeProjectionScreen(
  screen: ProjectionListScreenDefinition,
): EntityListScreenDefinition {
  return {
    id: screen.id,
    type: "entityList",
    entity: PROJECTION_PSEUDO_ENTITY,
    columns: screen.columns,
    ...(screen.rowRenderer !== undefined && { rowRenderer: screen.rowRenderer }),
    ...(screen.cardRenderer !== undefined && { cardRenderer: screen.cardRenderer }),
    ...(screen.rowActions !== undefined && { rowActions: screen.rowActions }),
    ...(screen.toolbarActions !== undefined && { toolbarActions: screen.toolbarActions }),
    ...(screen.pagination !== undefined && { pagination: screen.pagination }),
    ...(screen.pageSize !== undefined && { pageSize: screen.pageSize }),
    ...(screen.defaultSort !== undefined && { defaultSort: screen.defaultSort }),
    ...(screen.searchable !== undefined && { searchable: screen.searchable }),
    ...(screen.slots !== undefined && { slots: screen.slots }),
    ...(screen.access !== undefined && { access: screen.access }),
  };
}
