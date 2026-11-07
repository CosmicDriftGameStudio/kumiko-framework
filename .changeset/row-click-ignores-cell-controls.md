---
"@cosmicdrift/kumiko-renderer": patch
---

Row click ignores clicks from controls inside custom cells and from portaled content such as drawers.

<!-- kumiko-changes
feature: renderer
type: fix
title: Row click ignores controls inside custom cells and portaled content
detail: A list with a row click opened the row when a button, link or input inside a custom cell was clicked, and also on clicks inside a drawer or menu portaled from that row. Those clicks now stay with their control.
-->
