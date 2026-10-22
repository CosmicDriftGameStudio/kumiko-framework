---
"@cosmicdrift/kumiko-renderer": patch
---

A locked screen whose fallback is itself locked now heads the page with the screen that finally renders, not with the locked intermediate one. Only the outermost locked gate mounts the header; nested gates report their stand-in to it.

<!-- kumiko-changes
feature: renderer
type: fix
title: Locked fallback chains show the rendered screen in the header
detail: When a screen with visibleWhen falls back to another screen that is locked too, the page header and breadcrumb now name the screen that actually renders instead of the locked intermediate fallback.
-->
