---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

Related lists and expandable rows group through `table.grouping` on the server path; the client-side `groupBy` is gone.

<!-- kumiko-changes
feature: framework
type: breaking
title: relatedList groupBy replaced by table.grouping
detail: The groupBy key on a relatedList section and an entityList expandableRow is removed together with the RelatedListGroupBy type. Both group through table.grouping ({ field, label?, labels?, collapsedWhen? }): groups, counts and header measures come from one aggregate query over all matching rows instead of the loaded page, and each open group loads its own rows. An expandableRow takes only table.grouping with a fixed field; userChoice, fields and every other table option stay boot errors there. The boot validator reports a leftover groupBy with a pointer to table.grouping. ExpandableRowGrouping is the new type of an expandableRow's grouping.
migration: move groupBy { field, collapsedWhen, label, labels } to table: { grouping: { field, collapsedWhen, label, labels } }; the bound query must accept aggregate (entityListSchema does, a hand-written query answers it with answerListAggregate). dateField and the {lastDate} placeholder have no replacement on an expandableRow, where totals stay off; on a relatedList a max measure in table.totals shows the latest date. Every group now gets a header: a group without label or labels entry shows its value instead of rendering headerless.
-->

<!-- kumiko-changes
feature: renderer
type: breaking
title: DataTable rowGrouping removed
detail: The client-side rowGrouping prop and the DataTableRowGrouping type are removed from the DataTable contract; grouping runs only through serverGroups. A custom DataTable primitive drops its rowGrouping handling.
migration: delete rowGrouping from custom DataTable primitives and their callers; group lists through table.grouping on the screen
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Totals row keeps its leading cells pinned
detail: With pinned columns, the empty totals cells under the checkbox and expand columns stick to the left like the cells above them, and the cell under the actions column sticks to the right with the same background.
-->
