---
"@cosmicdrift/kumiko-renderer": patch
---

A trailing row-action column of a wide list stays visible at the right edge from md.

<!-- kumiko-changes
feature: renderer
type: fix
title: Row-action column of wide lists no longer scrolls out of view
detail: A list whose last column is a row action (rowActionLink or display button) now pins that column to the right edge from md, with the same background as the "⋯" column, so the action stays reachable when the columns are wider than the screen. When the list also has a "⋯" column, that column keeps the edge and the row-action column scrolls in flow. Nothing to do for apps.
-->
