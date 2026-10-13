---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

A select sub-field of an embedded list can be shown as segmented buttons in its table cell. Declare `display: "radio"` on the sub-field, the same option a single select field already has; the default in a cell stays a dropdown.

<!-- kumiko-changes
feature: types
type: improvement
title: display on embedded select sub-fields
detail: The select variant of EmbeddedSubFieldDef accepts display radio or dropdown.
-->

<!-- kumiko-changes
feature: headless
type: improvement
title: Embedded list cells carry the select display
detail: EmbeddedListCellViewModel.display is taken from the sub-field.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: EmbeddedListColumn.display
detail: EmbeddedListField forwards the select display to the EmbeddedListInput primitive.
-->

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Segmented select in embedded list cells
detail: A select column with display radio renders the SegmentedSelect control, now in its own module so the embedded list input can use it.
-->
