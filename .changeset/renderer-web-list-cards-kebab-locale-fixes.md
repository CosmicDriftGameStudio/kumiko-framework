---
"@cosmicdrift/kumiko-renderer-web": patch
---

The row-actions kebab confirm dialog uses `confirmLabel` like the inline path. A list cell with `renderer.locale` explicitly set to `undefined` falls back to the app locale. The narrow-viewport card list keeps the bare `testId` on a wrapper, and its sort select shows a sort that targets a non-sortable column instead of "Unsorted". A bare form renders its `headerRegion`. The dashboard time range no longer needs a type assertion.

<!-- kumiko-changes
feature: renderer
type: fix
title: Kebab confirmLabel, cell locale fallback, card-list sort select and bare-form headerRegion
-->
