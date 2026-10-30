import type { BootRuleTable } from "./boot-rule.ts";

export const NAMED_FILTER_RULES = {
  projectionQueryAcceptsNamedFilter: {
    id: "named-filter/projection-query-accepts-named-filter",
    summary: "A projectionList with namedFilters binds a query whose schema has a namedFilter key.",
    fix: "Add namedFilter: z.string().optional() to the query schema, resolve it with resolveNamedListFilters and pass the conditions into executor.list filters, the only path that applies field-read and PII guards.",
  },
  statNavigateTarget: {
    id: "named-filter/stat-navigate-target",
    summary: "A stat navigate.screen resolves to an entityList or projectionList screen.",
    fix: "Point navigate.screen at a registered list screen.",
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
