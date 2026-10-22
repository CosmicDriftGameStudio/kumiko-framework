---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

Lists group on the server with `table.grouping`, show a footer row with `table.totals` and filter number fields with a from/to range facet.

<!-- kumiko-changes
feature: framework
type: breaking
title: Money list aggregates answer one value per currency
detail: A sum, avg, min or max measure over a money field in a list aggregate now answers [{ currency, value }] with value in minor units, one entry per currency in the matching rows, and never adds amounts of different currencies. Before, it answered one plain number over all currencies.
migration: code reading measures of a money field from a list aggregate answer (executor.aggregate, answerListAggregate or the list query with aggregate) reads an array of { currency, value } instead of a number; take the entry of the wanted currency, value stays in minor units
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: table.grouping, table.totals and range facets validated at boot
detail: The table block takes grouping ({ field, label?, labels?, collapsedWhen?, userChoice?, fields? }) and totals ([{ field, kind }]). The boot validator checks the fields against the entity or the columns, rejects measures a field type cannot carry and requires the list query to accept aggregate (entityListSchema does; hand-written queries answer it with answerListAggregate). facets.<field>.display "range" needs a filterable number, decimal, money or bigInt field.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Server-side groups, totals row and number range facet in the DataTable
detail: With table.grouping the groups load via one aggregate query; each open group near the viewport loads its rows with the list query plus a group filter, page by page with "Load more", at most four groups at once, a collapsed group sends no query. Headers show the server count and measures, the global pager gives way in both pagination modes, and the view menu offers "Group by" with userChoice. table.totals renders a live footer row over the filters and search. A range facet shows from/to inputs, keeps <screenId>.f.<field>.min/.max in the URL and sends gte/lte filters, money in minor units. Infinite lists now also start over when a facet changes. New keys kumiko.list.group.*, kumiko.list.measure.*, kumiko.list.totals.label, kumiko.list.range.* and kumiko.list.notice.* in all locale packages.
-->
