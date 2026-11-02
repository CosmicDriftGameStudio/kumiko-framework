---
"@cosmicdrift/kumiko-renderer": patch
---

The sidebar navigation keeps the containers a user collapsed when the sidebar remounts or the screen changes; navigating into a collapsed container opens only that container.

<!-- kumiko-changes
feature: renderer
type: fix
title: sidebar nav no longer re-expands collapsed containers on screen change
detail: The collapsed set of `NavTree` was component state that reset whenever the shell remounted the sidebar (focus mode, mobile sheet). It is now kept in sessionStorage (`kumiko.nav.collapsed`, access wrapped in try/catch). Navigating to a screen opens the containers on its path and no other collapsed container; the search filter still opens everything temporarily and restores the stored state when cleared.
-->
