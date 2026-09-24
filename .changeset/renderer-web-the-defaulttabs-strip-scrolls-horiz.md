---
"@cosmicdrift/kumiko-renderer-web": patch
---

The DefaultTabs strip scrolls horizontally in itself instead of widening the page (fw#3234)

A tab strip with more tabs than fit the viewport previously pushed the page's own width out. The strip now sits in its own overflow-x-auto container (`min-w-0` on both the Tabs root and that container, so the flex child can actually shrink below its content width for overflow-x-auto to take effect).

<!-- kumiko-changes
feature: renderer-web
type: fix
title: The DefaultTabs strip scrolls horizontally in itself instead of widening the page (fw#3234)
-->
