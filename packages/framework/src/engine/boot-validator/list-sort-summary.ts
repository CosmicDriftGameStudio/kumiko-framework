import type { QueryHandlerDef } from "@cosmicdrift/kumiko-types/handlers";
import type {
  EntityListScreenDefinition,
  ListTableSummaryRow,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-types/screen";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import type { FeatureDefinition } from "../types/index.ts";
import { LIST_TABLE_SUMMARY_ROW_KEYS } from "../types/screen.ts";
import { bootRuleError } from "./boot-rule.ts";
import { LIST_SORT_SUMMARY_RULES } from "./list-sort-summary-rules.ts";
import { rejectUnknownKeys } from "./list-table-reject-unknown-keys.ts";
import { buildQueryHandlerMap } from "./projection-list-screens.ts";
import { getZodObjectShape } from "./zod-shape.ts";

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

// The keys the list sends for what the screen declares; the summary query gets the same ones so
// its numbers follow the narrowing the user sees.
function listKeysSentBy(screen: ListScreen): readonly string[] {
  return [
    ...(screen.searchable === true ? ["search"] : []),
    ...(screen.namedFilters !== undefined ? ["namedFilter"] : []),
    ...(screen.filter !== undefined ? ["filter"] : []),
    ...(screen.type === "projectionList" && screen.facets !== undefined ? ["filters"] : []),
  ];
}

function validateSummaryRowQuery(
  prefix: string,
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
  const missing = listKeysSentBy(screen).filter((key) => shape === undefined || !(key in shape));
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
}

export function validateListSortAndSummary(features: readonly FeatureDefinition[]): void {
  const queryHandlers = buildQueryHandlerMap(features);
  for (const feature of features) {
    for (const screen of Object.values(feature.screens)) {
      if (screen.type !== "entityList" && screen.type !== "projectionList") continue;
      const prefix = `[${screen.type}] Feature "${feature.name}" screen "${screen.id}"`;
      if (screen.type === "projectionList") {
        validateProjectionSortOptions(prefix, screen, queryHandlers);
      }
      if (screen.table?.summaryRow !== undefined) {
        validateSummaryRowQuery(prefix, screen, screen.table.summaryRow, queryHandlers);
      }
    }
  }
}
