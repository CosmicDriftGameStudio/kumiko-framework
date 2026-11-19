---
"@cosmicdrift/kumiko-renderer": patch
---

The sidebar scrolls the active entry into view when it opens and when the route changes, so a long navigation no longer hides where you are.

<!-- kumiko-changes
feature: renderer
type: fix
title: Sidebar scrolls the active entry into view
detail: NavTree calls scrollIntoView({ block: "nearest" }) on the active entry on mount and when the active screen changes, also after it opened a collapsed container to show the entry. The list only moves when the entry is out of view, and collapsing another container afterwards does not pull it back. Nothing to do for apps.
-->
