---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

Lists get `bulkActions`: row checkboxes, a selection bar and a run that calls a writeHandler row action once per selected row.

<!-- kumiko-changes
feature: framework
type: improvement
title: bulkActions on entityList, projectionList and relatedList
detail: Each entry is { id, rowAction, confirm? } and points at a writeHandler entry of the same screen's rowActions. The boot validator rejects unknown keys, a non-kebab or duplicate id, an unknown rowAction and a rowAction of kind clientAction, navigate or drawer.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: DataTable row selection and bulk run
detail: With bulkActions the table gets a checkbox column, a header checkbox for the loaded rows (at most 100), a checkbox per card and a bar with "n selected" and the actions. A run sends one /api/write per row, at most 4 at a time; rows hidden by the row action's visible are skipped. Cancel stops new writes. A banner shows succeeded, failed, skipped and not run; failed and not-run rows stay selected and the list reloads. With table.keyboardNavigation, Space toggles the focused row. New keys kumiko.list.bulk.* in all locale packages.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: entityList writeHandler row actions keep display
detail: entityList built its writeHandler row actions inline and dropped display; it now uses the same builder as projection and related lists.
-->
