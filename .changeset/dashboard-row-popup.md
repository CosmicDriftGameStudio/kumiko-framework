---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-types": patch
---

Dashboard list rows can open their record as a popup (rowLink.presentation); a full detail page with a footer form scrolls in one place only.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Dashboard list rows can open their record as a popup, and a detail page with a footer form scrolls in one place
detail: A dashboard list panel `rowLink` takes `presentation: "popup"` (with `screen` and `paramField`, the target a projectionDetail of the same feature) to open the row's record in a popup over the dashboard; the arrow link still points to the page, so a new tab or copy keeps working. Closing the popup reloads every panel of the dashboard. Boot validation rejects a popup with `screenField`, without `paramField`, or onto a screen that is no same-feature projectionDetail. On a full projectionDetail page with a footer form, header, tabs and footer stay visible and only the form content scrolls; before, the page and the form scrolled separately. A sticky table header now stays above the sticky row actions column, which used to paint over it while scrolling.
-->
