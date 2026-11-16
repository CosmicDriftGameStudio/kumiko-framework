---
"@cosmicdrift/kumiko-renderer": patch
---

The focus rail shows listed nav entries that sit inside a group.

<!-- kumiko-changes
feature: renderer
type: fix
title: focus rail shows listed entries that sit inside a group
detail: `focusRailNavQns` only matched top-level nav nodes, so a listed entry below a group was missing from the rail. The rail now finds listed entries at any depth and shows them in list order. When a listed entry nests in another listed tile, only the inner one is marked active.
-->
