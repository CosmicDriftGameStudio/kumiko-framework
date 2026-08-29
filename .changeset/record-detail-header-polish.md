---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Fixes `projectionDetail` record-layout polish (0.226.0 regression): the metrics band now renders through a new `Metric` core-primitive (compact, left-aligned, non-stretched tiles that wrap on narrow viewports) instead of naked `Text`, which had rendered label and value glued together with no visual hierarchy. The header/metrics/tab strip now share the record card's page padding and get visible vertical spacing between them, via a new `Form.headerRegion` slot. `hideSectionTitles` now also suppresses `RenderEdit`'s own top-level form title (previously only section titles were suppressed), fixing a duplicate heading above the active tab's content in `layout.mode: "tabs"`.

Also fixes fw#2518: navigating from one `projectionDetail` record to the next didn't remount the body, so the screen briefly showed the previous record's fields. `ProjectionDetailBody` is now keyed on the record identifier alone (never the active tab, so switching tabs doesn't refire the detail query).
