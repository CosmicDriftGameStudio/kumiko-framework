---
"@cosmicdrift/kumiko-renderer": patch
---

The scroll container of a `scrollBody` list and of the dashboard list keeps sr-only cell labels inside, so a wide table no longer widens the page.

<!-- kumiko-changes
feature: renderer
type: fix
title: Wide list tables no longer widen the page
detail: The scroll container of a list with `scrollBody` (`<testId>-scroll`, default `render-list-scroll`) and the horizontal scroll container of the dashboard list panel had no positioning. Absolutely placed sr-only labels in cells, for example of a boolean cell or a link icon, then took the page as their containing block, so a table wider than its container made the whole page scroll sideways. Both containers are now `relative`. Apps that set `position: relative` on `render-list-table-scroll` themselves can drop that rule.
-->
