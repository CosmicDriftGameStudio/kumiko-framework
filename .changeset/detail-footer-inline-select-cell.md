---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-renderer": patch
---

A projectionDetail can pin one writeForm as a footer under every tab, and a relatedList select column can be edited in place.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Footer form on a detail screen and an editable select cell in related lists
detail: A writeForm section with `placement: "footer"` renders as a fixed footer under the tab content on every tab, is no tab of its own and sets no `handler`, `submitLabel` or `submitWith`. Each writeHandler action in its `actions` validates the form and sends its own payload plus the form values in one write. Boot rejects a second footer, a footer in a wizard layout, and a footer without a registered writeHandler action. A relatedList column can set `edit: { handler, when?, required? }` on a select field of the section's entity: where `when` holds the cell is a select, a choice writes `{ id, [field] }` through the handler and reloads the list and the host. `edit.field` names another select field of the entity: the column's cell then shows that field's dropdown, options and value, and writes `{ id, [edit.field] }`. A struck row does not strike the select. Native tables show the value instead of the select.
-->
