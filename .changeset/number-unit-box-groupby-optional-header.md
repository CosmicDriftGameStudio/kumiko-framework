---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-types": minor
---

A number field's unit now always sits inside the field. Before, a label wider than the input (for example once the "changed" marker appeared) widened the form cell, and the unit moved to the right edge of the cell, next to the field. relatedList `groupBy.label` is optional: a group with neither `label` nor a `labels` entry shows its rows without a header and stays open, so a list can show only a "done" header above its open rows. Boot rejects a `collapsedWhen` group that has no header. `DataTableRowGrouping.headerLabel` may return `undefined` for such a group. The required i18n keys now include the `groupBy` header keys of an entityList `expandableRow`, not only those of projectionDetail sections.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: A number field's unit stays inside the field when the label is wider than the input
detail: |
  Icon, input and unit of a `kind: "number"` input share one box (`data-slot="number-field"`), and the form grid's number cell sizes that box to 8rem instead of the bare input. Before, a label wider than the input (a long label, or the "changed" marker appearing while editing) widened the cell, and the unit was anchored to the cell's right edge, next to the field.
migration: |
  No code change needed. Custom CSS that sized number inputs through `[&_input]` inside the number cell targets `[data-slot=number-field]` now.
-->

<!-- kumiko-changes
feature: types
type: improvement
title: relatedList groupBy.label is optional; groups without a header show their rows directly
detail: |
  `RelatedListGroupBy.label` is optional. The header key of a group is `labels[value] ?? label`; a group without one renders its rows without a header row and never collapses. `relatedListGroupKey` and `relatedListGroupHeaderLabel` resolve the group key and its header key; `collapsedWhen: null` now matches rows whose field is empty.
migration: |
  No code change needed. To hide a header, drop `label` and name only the groups that keep one in `labels`, for example `{ field: "status", collapsedWhen: "done", labels: { done: "<key>" } }`.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Boot rejects a collapsed relatedList group without a header; expandableRow groupBy keys are required i18n keys
detail: |
  Boot fails when `groupBy.collapsedWhen` names a group that has neither `label` nor a `labels` entry, because its rows could never be opened. The required surface keys now include `groupBy.label` and `groupBy.labels` of an entityList `expandableRow`, as they already did for projectionDetail relatedList sections.
migration: |
  Add translations for expandableRow `groupBy` header keys if the i18n check reports them missing.
-->

<!-- kumiko-changes
feature: renderer
type: breaking
title: DataTableRowGrouping.headerLabel may return undefined
detail: |
  `DataTableRowGrouping.headerLabel` returns `string | undefined`. `undefined` means the group has no header: the default web DataTable renders its rows without a header row and never collapses them.
migration: |
  Custom DataTable primitives that render `rowGrouping` handle `undefined` from `headerLabel` by rendering the group's rows without a header.
-->
