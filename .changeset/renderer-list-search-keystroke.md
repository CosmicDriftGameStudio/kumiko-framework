---
"@cosmicdrift/kumiko-renderer": patch
---

List search no longer drops a keystroke typed while the list is mounting: the search buffer syncs from the prop during render instead of in a mount-time effect that could reset it.

<!-- kumiko-changes
feature: renderer
type: fix
title: List search no longer drops input typed while the list mounts
-->
