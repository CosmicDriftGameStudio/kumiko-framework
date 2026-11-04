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
detail: A toned row (`rowTone`, `rowToneField`) now draws a 3px stripe on the left instead of filling the row. `sortOptions: [{ field, dir, label }]` on projectionList and entityList adds a "Sorted by" select to the toolbar (and the card layout, replacing the per-column entries; i18n key `kumiko.list.sort-by`). `table.summaryRow: { query }` (projectionList and entityList) shows a line of "label value" pairs from that query under the rows; the query gets the list's filters and search. A hint column's `width` and `minWidth` apply without `table.resizing`. Below 768 px a rowAction with `display: "button"` renders as an outline button at the bottom right of the card. `DashboardListPanel` gets `subtitle`, `showTotal` ("n of m" from the query's `total`) and `footerLink: { label, screen, namedFilter?, params? }`; `DashboardStatGroupPanel` gets `layout: "card" | "strip"` and `link: { label, screen }`. A dashboard stat tile with a `tone` draws the same left stripe, and `MetricSpec.subField` shows a second line under a metric value. A dashboard stat's `navigate` may target a custom screen (no `namedFilter`). projectionDetail takes `metricsPlacement: { narrow: "after-guidance" }` (below md the metrics follow the summary and steps) and `progress.placement: "beside-steps"` (the chains become a stacked stage list in a 4/12 column next to the steps from lg); `StepBar` gets `orientation: "stacked"`. `setupTestStack({ now })` starts the stack with a manual clock at that instant (string or Temporal.Instant); `extraContext.clock` still wins. New boot rules `list/sort-option-not-sortable`, `list/summary-row-shape`, `list/summary-row-query-unknown`, `list/summary-row-query-accepts-list-keys`, `dashboard/list-footer-link-unknown-screen`, `dashboard/stat-navigate-custom-with-filter`, `list/summary-row-on-related-list`, `record/progress-beside-steps-without-steps`; `list-table/column-width-without-resizing` no longer applies to hint columns; `query/output-field-missing` also checks `MetricSpec.subField`.
-->
