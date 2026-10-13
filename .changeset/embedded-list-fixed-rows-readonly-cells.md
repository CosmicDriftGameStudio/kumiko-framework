---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

An embedded list field on an edit screen can lock parts of its table. `{ field: "checkpoints", embeddedList: { readOnlyCells: ["text"], fixedRows: true } }` shows the named columns as non-editable cells and removes add, remove, duplicate and move (including Tab-appends-a-row and pasting past the last row), while the other cells stay editable. Boot validation rejects `embeddedList` on a field that is not an embedded list and `readOnlyCells` that are not sub-fields.

<!-- kumiko-changes
feature: types
type: improvement
title: EditFieldSpec.embeddedList for read-only cells and fixed rows
detail: New EmbeddedListEditSpec with readOnlyCells and fixedRows on the object form of EditFieldSpec.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Boot check for embeddedList on edit fields
detail: validateBoot requires the field to be an embedded list and every readOnlyCells entry to be a sub-field.
-->

<!-- kumiko-changes
feature: headless
type: improvement
title: Edit view model carries read-only cells and fixed rows
detail: EmbeddedListCellViewModel.readOnly and EditFieldViewModel.embeddedListFixedRows are derived from EditFieldSpec.embeddedList.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: EmbeddedListColumn.readOnly and EmbeddedListInput fixedRows
detail: EmbeddedListField forwards both, skips readOnly columns when pasting and never appends rows from a paste when rows are fixed.
-->

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Embedded list input honours readOnly cells and fixed rows
detail: A readOnly column renders disabled cells; fixedRows hides the actions column, the add button and the empty-state button and stops Tab/Enter from appending a row.
-->
