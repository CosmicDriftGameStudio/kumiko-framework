---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

projectionDetail tab panels get page padding, recordTitleField on projectionDetail, toggles line up in flow forms

Tab panels on a projectionDetail with `layout.mode: "tabs"` now pad their content like the rest of the page: extension, field-section, groups and writeForm tabs render as an unframed padded panel with space below the tab strip. relatedList tabs stay flush. This fixes extension tabs sitting flush against the shell edge since 0.330.0. `CardOptions.framed` (default true) drops the card frame and keeps the padding. A projectionDetail can set `recordTitleField` to show a query output field as the record title in the header breadcrumb. The boot check requires the field to be in the query's outputSchema and rejects it next to `header`. In flow forms, boolean fields use the new `FieldCellWidth` value `"toggle"`, which replaces `"auto"`: the label shares the top line with its neighbours and the switch sits on the input line.

<!-- kumiko-changes
feature: renderer
type: improvement
title: projectionDetail tab panels get page padding, recordTitleField on projectionDetail, toggles line up in flow forms
migration: |
  Extension tab components that added their own padding to make up for the flush panel in 0.330.0 should drop it. Set `recordTitleField: "<field>"` on a projectionDetail without `header` to show the record name in the breadcrumb. Custom Grid primitives keyed by `FieldCellWidth` must rename `auto` to `toggle`.
-->
