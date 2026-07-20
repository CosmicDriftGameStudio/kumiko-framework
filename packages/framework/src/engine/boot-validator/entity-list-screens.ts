import { normalizeListColumn } from "../screen-helpers";
import type { EntityListScreenDefinition, FeatureDefinition } from "../types";

/** Operator lists default searchable; low-cardinality audit trails stay opt-out. */
export const SEARCHABLE_FALSE_WHITELIST = new Set(["download-attempt-list"]);

function hasFilterableFields(feature: FeatureDefinition, entityName: string): boolean {
  const entities = feature.entities;
  if (!entities) return false;
  const entity = entities[entityName];
  if (!entity) return false;
  return Object.values(entity.fields).some(
    (raw) => (raw as { readonly filterable?: boolean }).filterable === true,
  );
}

function hasEntityEditDetail(feature: FeatureDefinition, entityName: string): boolean {
  return Object.values(feature.screens).some(
    (s) => s.type === "entityEdit" && s.entity === entityName,
  );
}

function validateOneEntityListScreen(
  feature: FeatureDefinition,
  screen: EntityListScreenDefinition,
): void {
  const prefix = `[entityList] Feature "${feature.name}" screen "${screen.id}"`;

  if (screen.searchable === false && !SEARCHABLE_FALSE_WHITELIST.has(screen.id)) {
    throw new Error(
      `${prefix}: searchable defaults to true for operator lists — set searchable: true or add "${screen.id}" to the whitelist`,
    );
  }

  const filtersActive = hasFilterableFields(feature, screen.entity);
  const searchable = screen.searchable !== false;
  if ((searchable || filtersActive) && screen.defaultSort === undefined) {
    throw new Error(
      `${prefix}: defaultSort required when searchable or filterable fields are active`,
    );
  }

  if (screen.defaultSort !== undefined) {
    const sortField = screen.defaultSort.field;
    const col = screen.columns.find((c) => normalizeListColumn(c).field === sortField);
    if (col === undefined) {
      throw new Error(`${prefix}: defaultSort.field "${sortField}" is not a listed column`);
    }
    const entityDef = feature.entities?.[screen.entity];
    const fieldDef = entityDef?.fields[sortField];
    const isSortable =
      fieldDef !== undefined && "sortable" in fieldDef && fieldDef.sortable === true;
    if (!isSortable) {
      throw new Error(`${prefix}: defaultSort column "${sortField}" must be sortable`);
    }
  }

  if (hasEntityEditDetail(feature, screen.entity)) {
    const hasNavigate = (screen.rowActions ?? []).some(
      (a) => a.kind === "navigate" && (a.id === "view" || a.id === "edit"),
    );
    if (!hasNavigate) {
      throw new Error(
        `${prefix}: detail screen exists — add a navigate rowAction with id "view" or "edit"`,
      );
    }
  }

  for (const col of screen.columns) {
    const normalized = normalizeListColumn(col);
    if (normalized.label === undefined) {
      const entity = feature.entities?.[screen.entity];
      const isDerived = entity?.derivedFields?.[normalized.field] !== undefined;
      if (!entity?.fields[normalized.field] && !isDerived) {
        throw new Error(`${prefix}: unknown column field "${normalized.field}"`);
      }
    }
  }
}

export function validateEntityListScreens(features: readonly FeatureDefinition[]): void {
  for (const feature of features) {
    for (const screen of Object.values(feature.screens)) {
      if (screen.type !== "entityList") continue;
      validateOneEntityListScreen(feature, screen);
    }
  }
}
