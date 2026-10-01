---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

projectionDetail tab panels get page padding, recordTitleField on projectionDetail

Tab panels on a projectionDetail with `layout.mode: "tabs"` now pad their content like the rest of the page: extension, field-section, groups and writeForm tabs render as an unframed padded panel with space below the tab strip. relatedList tabs stay flush. This fixes extension tabs sitting flush against the shell edge since 0.330.0. `CardOptions.framed` (default true) drops the card frame and keeps the padding. A projectionDetail without `header` can set `recordTitleField`: the query output field then titles the page header (breadcrumb "list > record"). The boot check requires the field to be in the query's outputSchema and rejects it next to `header`.

<!-- kumiko-changes
feature: renderer
type: improvement
title: projectionDetail tab panels get page padding, recordTitleField on projectionDetail
migration: |
  Extension tab panels get their padding back, so extension components that added their own padding to make up for the flush panel in 0.330.0 should drop it. Set `recordTitleField: "<field>"` on a projectionDetail without `header` to show the record name in the breadcrumb.
-->
