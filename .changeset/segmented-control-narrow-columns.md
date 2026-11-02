---
"@cosmicdrift/kumiko-renderer": patch
---

Segmented select controls no longer overlap their labels in narrow columns.

<!-- kumiko-changes
feature: renderer
type: fix
title: Segmented control labels wrap instead of overlapping in narrow columns
detail: Segments of the select segment control kept their longest word as minimum width and spilled into the neighbouring segment. Segments now shrink to their column (`minmax(0,1fr)`, `min-w-0`) and break long words.
-->
