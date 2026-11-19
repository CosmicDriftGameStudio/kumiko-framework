---
"@cosmicdrift/kumiko-renderer": patch
---

A table row action's `confirm` can be a function of the row, so the dialog names what is about to be deleted.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Row action confirm text can come from the row
detail: `DataTableRowAction.confirm` accepts `(row) => string` besides a plain string; the confirm dialog shows the returned text for the clicked row. `QueryTable` also takes `sort`/`onSortChange` with per-column `sortable`, a column `renderer` (a client plugin's `columnRenderers` entry) and `screenPadding={false}` for a table inside a screen that pads itself. A plain string keeps working; nothing to do for apps. Visible in every app: the sort arrow of a sortable table header now shows at rest (faint) instead of only on hover.
-->
