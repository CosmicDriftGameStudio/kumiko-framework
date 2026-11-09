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

An actionForm can show a preview of what the submit will do.

<!-- kumiko-changes
feature: framework
type: improvement
title: actionForm preview from a query over the form values
detail: An actionForm `preview` `{ query, fields?, title?, facts?, list? }` shows a panel above the submit button. The query runs over the current form values 300 ms after the last change, not while a required sent field is empty; empty optional fields stay out of the query payload. Its result renders as facts and a table. A failing query shows a hint and never blocks the submit. The boot validator checks the query, the sent fields and the labels (rules `action-form-preview/*`). A form bulk action's write handler must bound the id list with `.max(MAX_BULK_SELECTION)` and check every id itself. Facts (also the success box ones) and list columns take an optional `type` (`number`, `money`, `date`, `timestamp`); a money value is `{ amount, currency }` in major units.
-->
