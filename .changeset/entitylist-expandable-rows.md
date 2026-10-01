---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

entityList rows can expand into a related list

`expandableRow` on an entityList declares a related list under each row, with the same fields as a projectionDetail `relatedList` section (query, `parentFilter` or `parentParam`, columns, row and toolbar actions, emptyState). The parent id is the row's `id`. An arrow button at the start of the row opens and closes the area, carries `aria-expanded`, and works by keyboard. Several rows can be open at once. A successful write from the area reloads both the related list and the parent list, so counters on the parent row update. The boot validator and the role projection check the area like a relatedList section. `DataTableProps` gains `expandedRowIds`, `onToggleRowExpanded` and `renderExpandedRow` for custom DataTable primitives.

<!-- kumiko-changes
feature: renderer
type: improvement
title: entityList rows can expand into a related list with its own row actions (expandableRow)
-->
