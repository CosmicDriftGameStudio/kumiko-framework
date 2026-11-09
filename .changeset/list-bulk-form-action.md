---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

List bulk actions can open a form for the whole selection.

<!-- kumiko-changes
feature: framework
type: improvement
title: Bulk action opens an actionForm with all selected ids
detail: A list `bulkActions` entry `{ id, label, icon?, screen, idsField }` opens the actionForm `screen` once for the checkbox selection. The selected ids arrive as a `string[]` in `idsField`, so the form's handler runs once for all rows. `idsField` must be a `multiSelect` with the new `display: "count"`, which shows "n selected" read-only. The ids travel in memory, so only the 100-row selection cap applies. The `rowAction` form is unchanged. The boot validator checks label, screen, actionForm type, field and layout (rules `list-bulk/form-*`).
-->
