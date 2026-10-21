// Shim for the ProjectionList renderer (analogous to action-form-shim.ts / config-edit-shim.ts).
//
// RenderList + computeListViewModel require an `entity: EntityDefinition` +
// `screen: EntityListScreenDefinition` pair, but only use `entity.fields`
// (column type/label) and the screen's list fields (columns/rowActions/…). A
// projectionList screen is query-driven and has NO entity, so these two helpers
// reshape the input ad hoc to reuse the existing list machinery. The query is
// NOT resolved here (the body reads `screen.query` directly).
//
// This preserves the same debt reservation as the other shims: if the list
// machinery later accesses additional EntityDefinition fields (transitions,
// idType, derivedFields), or a boot validator cross-references the
// schema.entities map, these type lies will fail silently. At that point, a
// query-native ListView component is needed.

import type {
  EntityDefinition,
  EntityListScreenDefinition,
  ListColumnSpec,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { normalizeListColumn } from "@cosmicdrift/kumiko-framework/ui-types";

const PROJECTION_PSEUDO_ENTITY = "__projection__";

// Satisfies the text-field PII stance of the entity field type; these synthesized
// fields describe query columns and never map to stored entity data.
export const SYNTHESIZED_FIELD_PII_REASON = "synthesized display field, not stored entity data";

/** Minimal EntityDefinition from the column list: every field is a text
 *  field. `sortable` applies to all columns — buildAppSchema derives it from
 *  the query's Zod schema (`screen.sortable`); the query itself has
 *  no per-field server-sort guarantee, so a column opts out with
 *  `sortable: false` when the handler cannot order by it.
 *  computeListViewModel only reads `fields[<col>].type` — text is enough,
 *  presentation comes from the column renderer + explicit label. */
export function synthesizeProjectionEntity(
  columns: readonly ListColumnSpec[],
  sortable: boolean,
): Pick<EntityDefinition, "fields"> {
  const fields: Record<string, EntityDefinition["fields"][string]> = {};
  for (const col of columns) {
    const normalized = normalizeListColumn(col);
    fields[normalized.field] = {
      type: "text",
      allowPlaintext: SYNTHESIZED_FIELD_PII_REASON,
      sortable: sortable && normalized.sortable !== false,
    };
  }
  return { fields };
}

/** Converts a ProjectionListScreenDefinition to the EntityListScreen shape
 *  expected by RenderList. `type` = "entityList" plus a pseudo-entity satisfy
 *  the type constraint; RenderList does not branch on `type` and reads `entity`
 *  only for error messages. The list fields are passed through unchanged. */
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
    ...(screen.createLabel !== undefined && { createLabel: screen.createLabel }),
    ...(screen.searchPlaceholder !== undefined && { searchPlaceholder: screen.searchPlaceholder }),
    ...(screen.slots !== undefined && { slots: screen.slots }),
    ...(screen.access !== undefined && { access: screen.access }),
    ...(screen.fillHeight !== undefined && { fillHeight: screen.fillHeight }),
  };
}
