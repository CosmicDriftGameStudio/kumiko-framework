---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Work-queue lists and briefing dashboards: named filters as a counted select with their own sort and empty state, button and badge columns in lists, and a 12-column dashboard grid.

<!-- kumiko-changes
feature: renderer
type: improvement
title: work-queue lists and briefing dashboards
detail: projectionList and entityList take `namedFilterFacet: { display: "select" | "chips", showCounts?, label? }`; `select` shows one single-choice dropdown and `showCounts` asks the list query once per filter for its hit count (`totalCount`). `NamedListFilterRef` gets `sort: { field, dir }` (applies while the URL carries no sort of its own, wins over `defaultSort`) and `emptyState: { title, description? }` (shown instead of the generic text when that filter yields no rows and no search is set, with a reset button). `ListColumnSpec.display` gains "button" (a column with a screen link draws a small outline button, dashboard list panels only) and "badge" now also works in the RenderList tables of entityList and projectionList, not only on dashboards; a row button in those tables stays a rowAction with `display: "button"`. The named-filter counts send the list's own payload for each filter (same filters, search, static params; no sort or paging), and defaultFilters stay off while a named filter is active. `DashboardPanelSpan` gains "third" and "two-thirds" on a 12-column grid, `DashboardListPanel.showHeader: false` drops the column header row and stacks the cells of each row below the sm breakpoint (with the header, the table keeps its normal layout), text paragraphs take `emphasis: "lead"`, and `RenderEditAction`s with `display: "link"` render as link buttons. The "Why?" of a hint column or a step opens as an inverted reason box behind an info icon (`ReasonBox`), and the sticky row-actions cell of a toned row mixes the tint into its opaque surface instead of cutting it off. New boot rules `list/named-filter-facet-without-filters`, `list/named-filter-empty-state-title-empty`, `list/button-column-without-link`, `list/button-column-in-list-table` (display "button" on a column outside dashboard list panels), `list/named-filter-sort-not-listed` and `list/named-filter-sort-not-sortable` (an entityList filter sort now reports under these instead of the defaultSort rules); `dashboard/panel-span-invalid` now lists the four spans, `named-filter/projection-query-accepts-sort` rejects a projectionList filter sort when the query schema has no `sort` and `sortDirection`, and `named-filter/projection-query-accepts-count` rejects `showCounts` when the query schema takes no `limit` and `totalCount`.
-->
