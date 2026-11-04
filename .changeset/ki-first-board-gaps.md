---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-testing": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Board gaps: toned rows as a left stripe, list sort options and a summary row, richer dashboard list and stat-group panels, stat tone stripes with sub lines, self-sizing hint columns, card buttons, detail progress beside the steps, and `setupTestStack({ now })`.

<!-- kumiko-changes
feature: renderer
type: improvement
title: board gaps in lists, dashboards and record details
detail: A toned row (`rowTone`, `rowToneField`) now draws a 3px stripe on the left instead of filling the row. `sortOptions: [{ field, dir, label }]` on projectionList and entityList adds a "Sorted by" select to the toolbar (and the card layout, replacing the per-column entries; i18n key `kumiko.list.sort.prefix`). `table.summaryRow: { query }` (projectionList and entityList) shows a line of "label value" pairs from that query under the rows; the query gets the list's filters and search. A hint column's `width` and `minWidth` apply without `table.resizing`. Below 768 px a rowAction with `display: "button"` renders as an outline button at the bottom right of the card. `DashboardListPanel` gets `subtitle`, `showTotal` ("n of m" from the query's `total`) and `footerLink: { label, screen, namedFilter?, params? }`; `DashboardStatGroupPanel` gets `layout: "cards" | "strip"` (a labelless group with `layout: "cards"` renders the cards grid without a heading) and `link: { label, screen }`. Visible changes: a dashboard StatCard with a `tone` colours its value and draws the same left stripe (warn uses the status-warn colour), a toned table row draws its stripe as an inset shadow that also holds on a pinned first column, and the detail progress cards and banner share the summary's px-6 inset. The summary row sits in the same tfoot as the totals. A card with a tone stripe gives up 3px of left padding. Also, `setupTestStack` returns the manual clock as `stack.clock`, and an invalid `now` string fails with a clear message. `metricsPlacement.narrow` moves only the metric tiles, in both the page header and the head card. A dashboard stat tile with a `tone` draws the same left stripe, and `MetricSpec.subField` shows a second line under a metric value. A dashboard stat's `navigate` may target a custom screen (no `namedFilter`). projectionDetail takes `metricsPlacement: { narrow: "after-guidance" }` (below md the metrics follow the summary and steps) and `progress.placement: "beside-steps"` (the chains become a stacked stage list in a 4/12 column next to the steps from lg); `StepBar` gets `orientation: "stacked"`. `setupTestStack({ now })` starts the stack with a manual clock at that instant (string or Temporal.Instant); `extraContext.clock` still wins. New boot rules `list/sort-options-invalid`, `list/sort-options-default-not-listed`, `list/sort-option-not-sortable`, `list/summary-row-shape`, `list/summary-row-query-unknown`, `list/summary-row-query-accepts-list-keys`, `dashboard/panel-link-target`, `dashboard/stat-navigate-custom-with-filter`, `list/summary-row-on-related-list`, `list/summary-row-with-totals` (a table keeps summaryRow or totals, not both), `projection-detail/progress-beside-steps-without-steps`; `list-table/column-width-without-resizing` no longer applies to hint columns; `query/output-field-missing` also checks `MetricSpec.subField`.
-->
