---
"@cosmicdrift/kumiko-renderer": patch
---

projectionDetail on a phone: with `metricsPlacement: { narrow: "after-guidance" }` in the screen form layout the metrics and tabs now stay above the tab content (the header parts get their own flex container), and `footerActions` that mix an `align: "start"` action with others stay visible in the pinned footer instead of folding into the "…" menu (nested footer fragments are flattened), the start group filling the row.

<!-- kumiko-changes
feature: renderer
type: fix
title: projectionDetail on a phone keeps metrics above the tabs and start-aligned footer actions visible
detail: With `metricsPlacement: { narrow: "after-guidance" }` the metrics and tabs stay above the tab content on a phone. `footerActions` that mix an `align: "start"` action with others stay in the pinned footer instead of folding into the "…" menu; the start group fills the row.
-->
