import type { BootRuleTable } from "./boot-rule.ts";

export const NAMED_FILTER_RULES = {
  projectionQueryAcceptsNamedFilter: {
    id: "named-filter/projection-query-accepts-named-filter",
    summary: "A projectionList with namedFilters binds a query whose schema has a namedFilter key.",
    fix: "Add namedFilter: z.string().optional() to the query schema, resolve it with resolveNamedListFilters and pass the conditions into executor.list filters, the only path that applies field-read and PII guards.",
  },
  projectionQueryAcceptsCount: {
    id: "named-filter/projection-query-accepts-count",
    summary:
      "A projectionList with namedFilterFacet.showCounts binds a query whose schema has limit and totalCount keys.",
    fix: "Add limit and totalCount: z.boolean().optional() to the query schema and return the total, or drop showCounts.",
  },
  projectionQueryAcceptsSort: {
    id: "named-filter/projection-query-accepts-sort",
    summary:
      "A projectionList whose namedFilter sets a sort binds a query whose schema has sort and sortDirection keys.",
    fix: "Add sort: z.enum([...sortable fields]) and sortDirection to the query schema and order by them, or remove sort from the named filter.",
  },
  filterSortNotListed: {
    id: "list/named-filter-sort-not-listed",
    summary: "A named filter's sort.field is one of the listed columns.",
    fix: "Pick a field from columns or add it there.",
  },
  filterSortNotSortable: {
    id: "list/named-filter-sort-not-sortable",
    summary: "A named filter's sort column is sortable.",
    fix: "Mark the field sortable or pick another sort field.",
  },
  facetWithoutFilters: {
    id: "list/named-filter-facet-without-filters",
    summary: "namedFilterFacet only presents the screen's namedFilters.",
    fix: "Declare namedFilters on the screen or remove namedFilterFacet.",
  },
  emptyStateTitleEmpty: {
    id: "list/named-filter-empty-state-title-empty",
    summary: "A named filter's emptyState.title is a non-empty i18n key.",
    fix: "Name the title key or remove emptyState from the filter.",
  },
  statNavigateTarget: {
    id: "named-filter/stat-navigate-target",
    summary: "A stat navigate.screen resolves to an entityList, projectionList or custom screen.",
    fix: "Point navigate.screen at a registered list or custom screen.",
  },
  statNavigateFilterDeclared: {
    id: "named-filter/stat-navigate-filter-declared",
    summary: "A stat navigate.namedFilter is declared in the target screen's namedFilters.",
    fix: "Add { id, label } to namedFilters of the target screen.",
  },
  statNavigateSameQuery: {
    id: "named-filter/stat-navigate-same-query",
    summary: "A stat with navigate counts with the target list's own query.",
    fix: "Set the stat query to the target list's query.",
  },
  statNavigateSameNamedFilter: {
    id: "named-filter/stat-navigate-same-named-filter",
    summary: "A stat's params.namedFilter equals navigate.namedFilter.",
    fix: "Set params.namedFilter to the same id as navigate.namedFilter.",
  },
  statNavigateStaticFilter: {
    id: "named-filter/stat-navigate-static-filter",
    summary: "A stat repeats the target screen's static filter in params.filter.",
    fix: "Set params.filter to the target screen's filter.",
  },
} as const satisfies BootRuleTable;
