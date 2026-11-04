import type { BootRuleTable } from "./boot-rule.ts";

export const LIST_SORT_SUMMARY_RULES = {
  sortOptionNotSortable: {
    id: "list/sort-option-not-sortable",
    summary:
      "Every sortOptions field is a listed, sortable column (entityList) or one the query sorts by (projectionList).",
    fix: "Mark the field sortable and list it as a column, or give the projectionList's query sort and sortDirection parameters.",
  },
  summaryRowShape: {
    id: "list/summary-row-shape",
    summary: "table.summaryRow is an object with a query string and optional params object.",
    fix: 'Write table.summaryRow as { query: "feature:query:order:summary" }.',
  },
  summaryRowQueryUnknown: {
    id: "list/summary-row-query-unknown",
    summary: "table.summaryRow.query names a registered query handler.",
    fix: "Use the qualified name of a query handler (feature:query:name) or remove summaryRow.",
  },
  summaryRowQueryAcceptsListKeys: {
    id: "list/summary-row-query-accepts-list-keys",
    summary:
      "The summaryRow query's Zod schema accepts every list key the screen sends (search, namedFilter, filters).",
    fix: "Add the missing keys to the query schema (or reuse the list query's filter shape) and apply them, or drop the feature on the screen.",
  },
  summaryRowOnRelatedList: {
    id: "list/summary-row-on-related-list",
    summary:
      "A relatedList section or expandableRow sets no table.summaryRow; only entityList and projectionList screens have a list payload to carry it.",
    fix: "Remove summaryRow from the relatedList, or put the summary on the list screen itself.",
  },
} as const satisfies BootRuleTable;
