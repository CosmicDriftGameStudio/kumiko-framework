import type { EntityListScreenDefinition } from "@cosmicdrift/kumiko-types/screen";
import { LIST_ROW_META_COLUMNS } from "../../ui-types/list-row-meta.ts";
import { normalizeListColumn } from "../screen-helpers.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { collectBootRuleViolations } from "./boot-report.ts";
import { type BootRule, bootRuleError } from "./boot-rule.ts";
import { isSortableSqlDerivedField } from "./derived-sql-fields.ts";
import { ENTITY_LIST_RULES } from "./entity-list-screens-rules.ts";
import { LIST_SORT_SUMMARY_RULES } from "./list-sort-summary-rules.ts";
import { NAMED_FILTER_RULES } from "./named-filter-rules.ts";

/** Operator lists default searchable; low-cardinality audit trails stay opt-out. */
export const SEARCHABLE_FALSE_WHITELIST = new Set(["download-attempt-list", "cap-list"]);

// Same set computeListViewModel (headless) can actually render — NOT
// db/table-builder's rowMetaFieldNames(softDelete), which also carries
// isDeleted/deletedAt/deletedById. Accepting those here would let a
// softDelete column pass the boot gate and then throw at render-time
// because the renderer's LIST_ROW_META_COLUMNS doesn't know them.
export const LIST_ROW_META_COLUMN_NAMES = new Set(Object.keys(LIST_ROW_META_COLUMNS));

export function hasFilterableFields(feature: FeatureDefinition, entityName: string): boolean {
  const entities = feature.entities;
  if (!entities) return false;
  const entity = entities[entityName];
  if (!entity) return false;
  return Object.values(entity.fields).some((raw) => "filterable" in raw && raw.filterable === true);
}

function hasEntityEditDetail(feature: FeatureDefinition, entityName: string): boolean {
  return Object.values(feature.screens).some(
    (s) => s.type === "entityEdit" && s.entity === entityName,
  );
}

type EntityListCheck = (feature: FeatureDefinition, screen: EntityListScreenDefinition) => void;

function screenPrefix(feature: FeatureDefinition, screen: EntityListScreenDefinition): string {
  return `[entityList] Feature "${feature.name}" screen "${screen.id}"`;
}

function checkSearchable(feature: FeatureDefinition, screen: EntityListScreenDefinition): void {
  if (screen.searchable === false && !SEARCHABLE_FALSE_WHITELIST.has(screen.id)) {
    throw bootRuleError(ENTITY_LIST_RULES.searchableFalse, {
      message: `${screenPrefix(feature, screen)}: searchable defaults to true for operator lists — set searchable: true or add "${screen.id}" to the whitelist`,
    });
  }
}

function checkDefaultSortRequired(
  feature: FeatureDefinition,
  screen: EntityListScreenDefinition,
): void {
  const filtersActive = hasFilterableFields(feature, screen.entity);
  const searchable = screen.searchable !== false;
  if ((searchable || filtersActive) && screen.defaultSort === undefined) {
    throw bootRuleError(ENTITY_LIST_RULES.defaultSortRequired, {
      message: `${screenPrefix(feature, screen)}: defaultSort required when searchable or filterable fields are active. Set defaultSort: { field, direction } on the screen.`,
    });
  }
}

function checkDefaultSortColumn(
  feature: FeatureDefinition,
  screen: EntityListScreenDefinition,
): void {
  // skip: a missing defaultSort is reported by checkDefaultSortRequired
  if (screen.defaultSort === undefined) return;
  checkSortSpecColumn(feature, screen, "defaultSort", screen.defaultSort.field, {
    notListed: ENTITY_LIST_RULES.defaultSortNotListed,
    notSortable: ENTITY_LIST_RULES.defaultSortNotSortable,
  });
}

function checkNamedFilterSortColumns(
  feature: FeatureDefinition,
  screen: EntityListScreenDefinition,
): void {
  for (const ref of screen.namedFilters ?? []) {
    if (ref.sort === undefined) continue;
    checkSortSpecColumn(feature, screen, `namedFilters "${ref.id}" sort`, ref.sort.field, {
      notListed: NAMED_FILTER_RULES.filterSortNotListed,
      notSortable: NAMED_FILTER_RULES.filterSortNotSortable,
    });
  }
}

function checkSortOptionColumns(
  feature: FeatureDefinition,
  screen: EntityListScreenDefinition,
): void {
  for (const option of screen.sortOptions ?? []) {
    checkSortSpecColumn(feature, screen, `sortOptions "${option.label}"`, option.field, {
      notListed: LIST_SORT_SUMMARY_RULES.sortOptionNotSortable,
      notSortable: LIST_SORT_SUMMARY_RULES.sortOptionNotSortable,
    });
  }
}

function checkSortSpecColumn(
  feature: FeatureDefinition,
  screen: EntityListScreenDefinition,
  label: string,
  sortField: string,
  rules: { readonly notListed: BootRule; readonly notSortable: BootRule },
): void {
  const prefix = screenPrefix(feature, screen);
  const col = screen.columns.find((c) => normalizeListColumn(c).field === sortField);
  if (col === undefined) {
    throw bootRuleError(rules.notListed, {
      message: `${prefix}: ${label}.field "${sortField}" is not a listed column. Pick a field from columns or add it there.`,
    });
  }
  const entityDef = feature.entities?.[screen.entity];
  const fieldDef = entityDef?.fields[sortField];
  const isSortable =
    (entityDef !== undefined && isSortableSqlDerivedField(entityDef, sortField)) ||
    (fieldDef !== undefined && "sortable" in fieldDef && fieldDef.sortable === true);
  if (!isSortable) {
    throw bootRuleError(rules.notSortable, {
      message: `${prefix}: ${label} column "${sortField}" must be sortable`,
    });
  }
}

function checkDetailNavigate(feature: FeatureDefinition, screen: EntityListScreenDefinition): void {
  // skip: only lists with a detail screen need a navigate row action
  if (!hasEntityEditDetail(feature, screen.entity)) return;
  const hasNavigate = (screen.rowActions ?? []).some(
    (a) => a.kind === "navigate" && (a.id === "view" || a.id === "edit"),
  );
  if (!hasNavigate) {
    throw bootRuleError(ENTITY_LIST_RULES.detailWithoutNavigate, {
      message: `${screenPrefix(feature, screen)}: detail screen exists — add a navigate rowAction with id "view" or "edit"`,
    });
  }
}

function checkColumns(feature: FeatureDefinition, screen: EntityListScreenDefinition): void {
  collectBootRuleViolations(screen.columns, (col) => {
    const normalized = normalizeListColumn(col);
    // skip: a labelled column is free text, not a field reference
    if (normalized.label !== undefined) return;
    const entity = feature.entities?.[screen.entity];
    const isDerived = entity?.derivedFields?.[normalized.field] !== undefined;
    // Row-meta column (id/tenantId/version/insertedAt/modifiedAt/...) is a
    // real base-table column without being a declared entity field — e.g.
    // a SystemAdmin cross-tenant list exposing tenantId.
    const isRowMeta = LIST_ROW_META_COLUMN_NAMES.has(normalized.field);
    if (!entity?.fields[normalized.field] && !isDerived && !isRowMeta) {
      throw bootRuleError(ENTITY_LIST_RULES.unknownColumn, {
        message: `${screenPrefix(feature, screen)}: unknown column field "${normalized.field}"`,
      });
    }
  });
}

function checkNamedFilters(feature: FeatureDefinition, screen: EntityListScreenDefinition): void {
  const declared = feature.entities?.[screen.entity]?.namedFilters ?? {};
  collectBootRuleViolations(screen.namedFilters ?? [], (ref) => {
    // skip: id is declared on the entity
    if (Object.hasOwn(declared, ref.id)) return;
    throw bootRuleError(ENTITY_LIST_RULES.unknownNamedFilter, {
      message: `${screenPrefix(feature, screen)}: namedFilters id "${ref.id}" is not declared in entity "${screen.entity}" namedFilters. Known: ${Object.keys(declared).sort().join(", ") || "(none)"}.`,
    });
  });
}

const ENTITY_LIST_CHECKS: readonly EntityListCheck[] = [
  checkSearchable,
  checkDefaultSortRequired,
  checkDefaultSortColumn,
  checkNamedFilterSortColumns,
  checkSortOptionColumns,
  checkDetailNavigate,
  checkColumns,
  checkNamedFilters,
];

export function validateEntityListScreens(features: readonly FeatureDefinition[]): void {
  const screens = features.flatMap((feature) =>
    Object.values(feature.screens).flatMap((screen) =>
      screen.type === "entityList" ? [{ feature, screen }] : [],
    ),
  );
  collectBootRuleViolations(screens, ({ feature, screen }) => {
    collectBootRuleViolations(ENTITY_LIST_CHECKS, (check) => check(feature, screen));
  });
}
