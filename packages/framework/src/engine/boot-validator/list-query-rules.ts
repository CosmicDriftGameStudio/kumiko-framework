import type { BootRuleTable } from "./boot-rule.ts";

export const LIST_QUERY_RULES = {
  derivedFlagHandAuthored: {
    id: "list-query/derived-flag-hand-authored",
    summary:
      "A projectionList sets neither sortable nor paginated, both come from the query's Zod schema.",
    fix: "Remove sortable and paginated from the screen.",
  },
  searchableWithoutSearchParam: {
    id: "list-query/searchable-without-search-param",
    summary: 'A searchable list binds a query whose Zod schema has a "search" parameter.',
    fix: 'Add a "search" field to the query schema or remove searchable: true.',
  },
  searchableWithoutSearchableField: {
    id: "list-query/searchable-without-searchable-field",
    summary: "A searchable projectionList does not list an entity that has no searchable field.",
    fix: "Mark a field searchable: true on the entity or remove searchable: true.",
  },
  searchableFalseDisablesSearch: {
    id: "list-query/searchable-false-disables-search",
    summary:
      'A projectionList whose query accepts "search" is searchable unless it is on the searchable-false whitelist.',
    fix: "Remove searchable: false or add the screen id to SEARCHABLE_FALSE_WHITELIST.",
  },
  defaultSortRequired: {
    id: "list-query/default-sort-required",
    summary: "A projectionList with active search or sort declares a defaultSort.",
    fix: "Set defaultSort: { field, direction } on the screen.",
  },
  filterParamMissing: {
    id: "list-query/filter-param-missing",
    summary: 'A projectionList that declares filter binds a query with a "filter" parameter.',
    fix: "Add a filter parameter to the handler's schema, or reuse entityListSchema's shape.",
  },
  facetsWithoutFiltersParam: {
    id: "list-query/facets-without-filters-param",
    summary:
      'A list that declares facets sent as filters binds a query with a "filters" parameter.',
    fix: "Add a filters parameter to the handler's schema, or reuse entityListSchema's shape.",
  },
  dateRangeSameParam: {
    id: "list-query/date-range-same-param",
    summary: "A dateRange facet names different params for its from and to bounds.",
    fix: "Use two different param names for from and to.",
  },
  dateRangeReservedParam: {
    id: "list-query/date-range-reserved-param",
    summary: "A dateRange facet bound does not use a reserved list-payload key.",
    fix: "Pick the query's own time-bound param names.",
  },
  dateRangeParamReused: {
    id: "list-query/date-range-param-reused",
    summary: "Each dateRange facet on a screen uses its own param names.",
    fix: "Give each dateRange facet its own param names.",
  },
  dateRangeParamMissing: {
    id: "list-query/date-range-param-missing",
    summary: "The query accepts every param a dateRange facet sends.",
    fix: "Add the param to the handler's schema or point params at keys it already accepts.",
  },
  countNeedsTabsLayout: {
    id: "list-query/count-needs-tabs-layout",
    summary: 'A relatedList section with count: true sits in a layout with mode "tabs".',
    fix: 'Use mode "tabs" or remove count.',
  },
  countAndCountField: {
    id: "list-query/count-and-count-field",
    summary: "A relatedList section declares either count or countField.",
    fix: "Pick one badge source.",
  },
  countParamMissing: {
    id: "list-query/count-param-missing",
    summary:
      "A relatedList section with count: true binds a query that accepts limit and totalCount.",
    fix: "Add the missing parameter to the query's Zod schema.",
  },
  parentFilterAndParentParam: {
    id: "list-query/parent-filter-and-parent-param",
    summary: "A relatedList section declares parentFilter or parentParam, not both.",
    fix: "Remove parentParam or drop parentFilter.",
  },
  parentFilterParamMissing: {
    id: "list-query/parent-filter-param-missing",
    summary: 'A relatedList section with parentFilter binds a query with a "filter" parameter.',
    fix: "Add a filter parameter to the handler's schema, or reuse entityListSchema's shape.",
  },
  parentFilterFieldUnknown: {
    id: "list-query/parent-filter-field-unknown",
    summary: "parentFilter.field is a declared field of the entity behind the section's query.",
    fix: "Use one of the known fields named in the message.",
  },
  groupByRemoved: {
    id: "related-list/group-by-removed",
    summary: "A relatedList section or expandableRow does not use the removed groupBy.",
    fix: "Use table.grouping and make the bound query accept aggregate.",
  },
  expandableRowTableKeys: {
    id: "related-list/expandable-row-table-keys",
    summary: "An entityList expandableRow sets only table.grouping.",
    fix: "Put the other table options on the entityList screen itself.",
  },
  expandableRowGroupingChoice: {
    id: "related-list/expandable-row-grouping-choice",
    summary: "An expandableRow sets no table.grouping.userChoice or fields, it has no view menu.",
    fix: "Set a fixed table.grouping.field.",
  },
  expandableRowBulkActions: {
    id: "related-list/expandable-row-bulk-actions",
    summary: "An entityList expandableRow declares no bulkActions.",
    fix: "Put bulkActions on the entityList screen itself.",
  },
} as const satisfies BootRuleTable;
