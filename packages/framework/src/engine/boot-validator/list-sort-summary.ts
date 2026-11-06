import type { QueryHandlerDef } from "@cosmicdrift/kumiko-types/handlers";
import {
  type EntityListScreenDefinition,
  type ListPayloadCapabilities,
  type ListTableSummaryRow,
  listPayloadKeysSent,
  type ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-types/screen";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import type { FeatureDefinition } from "../types/index.ts";
import { LIST_TABLE_SUMMARY_ROW_KEYS } from "../types/screen.ts";
import { bootRuleError } from "./boot-rule.ts";
import { hasFilterableFields } from "./entity-list-screens.ts";
import { LIST_SORT_SUMMARY_RULES } from "./list-sort-summary-rules.ts";
import { rejectUnknownKeys } from "./list-table-reject-unknown-keys.ts";
import { buildQueryHandlerMap, schemaAccepts } from "./projection-list-screens.ts";
import { getZodObjectShape, getZodStringLiterals } from "./zod-shape.ts";

export function validateSummaryRowShape(where: string, summaryRow: unknown): void {
  if (!isPlainObject(summaryRow)) {
    throw bootRuleError(LIST_SORT_SUMMARY_RULES.summaryRowShape, {
      message: `${where} table.summaryRow must be an object like { query: "feature:query:order:summary" }.`,
    });
  }
  rejectUnknownKeys(where, "table.summaryRow", summaryRow, LIST_TABLE_SUMMARY_ROW_KEYS);
  if (typeof summaryRow["query"] !== "string" || summaryRow["query"] === "") {
    throw bootRuleError(LIST_SORT_SUMMARY_RULES.summaryRowShape, {
      message: `${where} table.summaryRow.query must be a qualified query name.`,
    });
  }
  if (summaryRow["params"] !== undefined && !isPlainObject(summaryRow["params"])) {
    throw bootRuleError(LIST_SORT_SUMMARY_RULES.summaryRowShape, {
      message: `${where} table.summaryRow.params must be an object.`,
    });
  }
}

/** `where` is the full message prefix, as for validateListTableOptions. */
export function rejectSummaryRowOnRelatedList(where: string, table: unknown): void {
  if (isPlainObject(table) && table["summaryRow"] !== undefined) {
    throw bootRuleError(LIST_SORT_SUMMARY_RULES.summaryRowOnRelatedList, {
      message: `${where} sets table.summaryRow, but a relatedList has no list payload to carry it. Remove it or summarise on the list screen.`,
    });
  }
}

type ListScreen = EntityListScreenDefinition | ProjectionListScreenDefinition;

function entityListCapabilities(
  feature: FeatureDefinition,
  screen: EntityListScreenDefinition,
): Pick<ListPayloadCapabilities, "searchable" | "filters"> {
  const entity = feature.entities?.[screen.entity];
  const searchable =
    screen.searchable ??
    Object.values(entity?.fields ?? {}).some((f) => "searchable" in f && f.searchable === true);
  const hasRangeFacet = Object.values(screen.facets ?? {}).some(
    (facet) => facet !== false && facet.display === "range",
  );
  const filters =
    hasFilterableFields(feature, screen.entity) ||
    screen.defaultFilters !== undefined ||
    hasRangeFacet;
  return { searchable, filters };
}

function projectionListCapabilities(
  screen: ProjectionListScreenDefinition,
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
): Pick<ListPayloadCapabilities, "searchable" | "filters"> {
  const listSchema = queryHandlers.get(screen.query)?.schema;
  return {
    searchable: screen.searchable !== false && schemaAccepts(listSchema, "search"),
    filters: screen.facets !== undefined,
  };
}

// The keys the list sends for what the screen declares (mirrors the renderer); the summary query
// gets the same ones so its numbers follow the narrowing the user sees.
function listKeysSentBy(
  feature: FeatureDefinition,
  screen: ListScreen,
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
): readonly string[] {
  const derived =
    screen.type === "entityList"
      ? entityListCapabilities(feature, screen)
      : projectionListCapabilities(screen, queryHandlers);
  return listPayloadKeysSent({
    ...derived,
    namedFilters: screen.namedFilters !== undefined,
    screenFilter: screen.filter !== undefined,
  });
}

function validateSummaryRowQuery(
  prefix: string,
  feature: FeatureDefinition,
  screen: ListScreen,
  summaryRow: ListTableSummaryRow,
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
): void {
  const handler = queryHandlers.get(summaryRow.query);
  if (handler === undefined) {
    throw bootRuleError(LIST_SORT_SUMMARY_RULES.summaryRowQueryUnknown, {
      message: `${prefix}: table.summaryRow.query "${summaryRow.query}" is not a registered query handler.`,
    });
  }
  const shape = getZodObjectShape(handler.schema);
  const paramKeys = Object.keys(summaryRow.params ?? {});
  const missing = [...listKeysSentBy(feature, screen, queryHandlers), ...paramKeys].filter(
    (key) => shape === undefined || !(key in shape),
  );
  if (missing.length === 0) return;
  throw bootRuleError(LIST_SORT_SUMMARY_RULES.summaryRowQueryAcceptsListKeys, {
    message:
      `${prefix}: table.summaryRow.query "${summaryRow.query}" must accept ${missing.map((key) => `"${key}"`).join(", ")} ` +
      `in its Zod schema because the list sends them - add them to the schema or drop them from the screen.`,
  });
}

// The query is the only thing that can order a projection; without sort and sortDirection in its schema
// every pick from the select would 422.
function validateProjectionSortOptions(
  prefix: string,
  screen: ProjectionListScreenDefinition,
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
): void {
  const options = screen.sortOptions ?? [];
  // skip: no sortOptions declared
  if (options.length === 0) return;
  const shape = getZodObjectShape(queryHandlers.get(screen.query)?.schema);
  if (shape === undefined || !("sort" in shape) || !("sortDirection" in shape)) {
    throw bootRuleError(LIST_SORT_SUMMARY_RULES.sortOptionNotSortable, {
      message:
        `${prefix}: sortOptions need query "${screen.query}" to accept "sort" and "sortDirection" ` +
        `in its Zod schema - add them and order by them, or remove sortOptions.`,
    });
  }
  // A closed enum of sortable fields is the one case where the schema can be checked per option.
  const accepted = getZodStringLiterals(shape["sort"]);
  // skip: "sort" is an open string, nothing to compare the options against
  if (accepted === undefined) return;
  const rejected = options.find((option) => !accepted.includes(option.field));
  if (rejected !== undefined) {
    throw bootRuleError(LIST_SORT_SUMMARY_RULES.sortOptionNotSortable, {
      message:
        `${prefix}: sortOptions field "${rejected.field}" is not one of the values query "${screen.query}" ` +
        `accepts for "sort" (${accepted.join(", ")}) - every pick would fail with a 422.`,
    });
  }
  const acceptedDirections = getZodStringLiterals(shape["sortDirection"]);
  // skip: "sortDirection" is an open string
  if (acceptedDirections === undefined) return;
  const rejectedDirection = options.find((option) => !acceptedDirections.includes(option.dir));
  if (rejectedDirection !== undefined) {
    throw bootRuleError(LIST_SORT_SUMMARY_RULES.sortOptionNotSortable, {
      message:
        `${prefix}: sortOptions dir "${rejectedDirection.dir}" is not one of the values query "${screen.query}" ` +
        `accepts for "sortDirection" (${acceptedDirections.join(", ")}) - every pick would fail with a 422.`,
    });
  }
}

function validateSortOptionsList(prefix: string, screen: ListScreen): void {
  const options = screen.sortOptions;
  // skip: no sortOptions declared
  if (options === undefined) return;
  if (options.length === 0) {
    throw bootRuleError(LIST_SORT_SUMMARY_RULES.sortOptionsInvalid, {
      message: `${prefix}: sortOptions is empty - list at least one option or remove sortOptions.`,
    });
  }
  const seen = new Set<string>();
  for (const option of options) {
    const key = `${option.field}\u0000${option.dir}`;
    if (seen.has(key)) {
      throw bootRuleError(LIST_SORT_SUMMARY_RULES.sortOptionsInvalid, {
        message: `${prefix}: sortOptions lists field "${option.field}" with dir "${option.dir}" twice.`,
      });
    }
    seen.add(key);
  }
  const defaultSort = screen.defaultSort;
  if (
    defaultSort !== undefined &&
    !options.some((o) => o.field === defaultSort.field && o.dir === defaultSort.dir)
  ) {
    throw bootRuleError(LIST_SORT_SUMMARY_RULES.sortOptionsDefaultNotListed, {
      message: `${prefix}: defaultSort { field: "${defaultSort.field}", dir: "${defaultSort.dir}" } is not one of the sortOptions, so the select would open on no entry. Add it to sortOptions.`,
    });
  }
}

export function validateListSortAndSummary(features: readonly FeatureDefinition[]): void {
  const queryHandlers = buildQueryHandlerMap(features);
  for (const feature of features) {
    for (const screen of Object.values(feature.screens)) {
      if (screen.type !== "entityList" && screen.type !== "projectionList") continue;
      const prefix = `[${screen.type}] Feature "${feature.name}" screen "${screen.id}"`;
      validateSortOptionsList(prefix, screen);
      if (screen.type === "projectionList") {
        validateProjectionSortOptions(prefix, screen, queryHandlers);
      }
      if (screen.table?.summaryRow !== undefined) {
        validateSummaryRowQuery(prefix, feature, screen, screen.table.summaryRow, queryHandlers);
      }
    }
  }
}
