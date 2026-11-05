---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

Board gaps round 8: list card frame, toolbar actions placement, toolbar sort for projection lists, row opener in the kebab.

<!-- kumiko-changes
feature: renderer
type: improvement
title: board gaps round 8, list card frame, toolbar actions placement, opener in the kebab
detail: `ListTableOptions.frame: "card"` (entityList, projectionList and relatedList `table` block): from sm the table, summary row and pager sit in one bordered, rounded card with the pager at the card's end (toolbar and description stay above it); below sm the cards of the card layout are bordered, rounded cards with a gap and the tone stripe inside the card. Default unchanged (table frameless over the page width, pager at the page end); boot rule `list-table/frame-invalid`. `toolbarActionsPlacement: "toolbar"` on `EntityListScreenDefinition` and `ProjectionListScreenDefinition`: from md the `toolbarActions` end the filter row after the "Sorted by" select and the create button (primary actions with a plus icon) instead of standing in the page header; below md they stay in the header; boot rule `list/toolbar-actions-placement-without-actions`. `ProjectionListScreenDefinition.toolbarSort: true` now exists like on entity lists (boot rule `entity-list/toolbar-sort-without-sort-options` covers both). `rowActionMode: "menu"` keeps the row opener (`rowClick: true`) as an entry in the kebab, so every row has a kebab even when the opener is the only action; "adaptive" and "inline" are unchanged. New density level `relaxed` (`table.density.default`, view menu entry "Weit"/"Relaxed"): body cells get `py-3` from sm, the header row is unchanged. The record-detail-layout recipe's orders list uses `frame: "card"`.
-->
