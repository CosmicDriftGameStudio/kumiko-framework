---
"@cosmicdrift/kumiko-renderer-web": patch
---

The row-actions kebab no longer returns focus to its trigger while a confirm dialog is open, so keyboard and screen-reader users reach the dialog buttons. Column headers of the embedded-list desktop table truncate (with a `title`) inside their fixed-width column instead of overlapping the neighbouring header.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Row-actions kebab keeps focus in the confirm dialog, embedded-list headers truncate in fixed columns
-->
