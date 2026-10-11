---
"@cosmicdrift/kumiko-renderer": patch
---

projectionList ignores a URL sort param on columns that are not sortable

A stale link like `?<screen>.sort=<col>` onto a `sortable: false` or unknown column is no longer sent to the server (which answers 400 since 0.355); the screen falls back to its defaultSort.

<!-- kumiko-changes
feature: renderer
type: fix
title: projectionList ignores a URL sort param on columns that are not sortable
-->
