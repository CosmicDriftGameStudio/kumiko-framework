import type { EntityListScreenDefinition } from "@cosmicdrift/kumiko-types/screen";
import { LIST_ROW_META_COLUMNS } from "../../ui-types/list-row-meta.ts";
import { normalizeListColumn } from "../screen-helpers.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { collectBootRuleViolations } from "./boot-report.ts";
import { bootRuleError } from "./boot-rule.ts";
import { isSortableSqlDerivedField } from "./derived-sql-fields.ts";
import { ENTITY_LIST_RULES } from "./entity-list-screens-rules.ts";

/** Operator lists default searchable; low-cardinality audit trails stay opt-out. */
export const SEARCHABLE_FALSE_WHITELIST = new Set(["download-attempt-list", "cap-list"]);

// Same set computeListViewModel (headless) can actually render — NOT
// db/table-builder's rowMetaFieldNames(softDelete), which also carries
// isDeleted/deletedAt/deletedById. Accepting those here would let a
// softDelete column pass the boot gate and then throw at render-time
// because the renderer's LIST_ROW_META_COLUMNS doesn't know them.
export const LIST_ROW_META_COLUMN_NAMES = new Set(Object.keys(LIST_ROW_META_COLUMNS));

function hasFilterableFields(feature: FeatureDefinition, entityName: string): boolean {
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
  const prefix = screenPrefix(feature, screen);
  const sortField = screen.defaultSort.field;
  const col = screen.columns.find((c) => normalizeListColumn(c).field === sortField);
  if (col === undefined) {
    throw bootRuleError(ENTITY_LIST_RULES.defaultSortNotListed, {
      message: `${prefix}: defaultSort.field "${sortField}" is not a listed column. Pick a field from columns or add it there.`,
    });
  }
  const entityDef = feature.entities?.[screen.entity];
  const fieldDef = entityDef?.fields[sortField];
  const isSortable =
    (entityDef !== undefined && isSortableSqlDerivedField(entityDef, sortField)) ||
    (fieldDef !== undefined && "sortable" in fieldDef && fieldDef.sortable === true);
  if (!isSortable) {
    throw bootRuleError(ENTITY_LIST_RULES.defaultSortNotSortable, {
      message: `${prefix}: defaultSort column "${sortField}" must be sortable`,
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

const ENTITY_LIST_CHECKS: readonly EntityListCheck[] = [
  checkSearchable,
  checkDefaultSortRequired,
  checkDefaultSortColumn,
  checkDetailNavigate,
  checkColumns,
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
