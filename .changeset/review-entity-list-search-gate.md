---
"@cosmicdrift/kumiko-renderer": patch
---

An entity list that is not searchable no longer sends `search` when `q` is in the URL.

<!-- kumiko-changes
feature: renderer
type: fix
title: Non-searchable entity lists ignore a stale q in the URL
detail: The entity list payload now gates `search` on the same searchable decision as the toolbar, like the projection list already did. A leftover `?q=` can no longer reach a query handler that does not accept it, and the keys sent match what the boot validator derives.
-->
