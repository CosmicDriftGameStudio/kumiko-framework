---
"@cosmicdrift/kumiko-renderer": patch
---

Tab strips fit narrow panes, and the compact page header keeps the title whole.

<!-- kumiko-changes
feature: renderer
type: fix
title: Tab strips tighten their spacing in narrow containers
detail: DefaultTabs is a size container now. Below a strip width of 32rem (512px) it uses px-2.5 and gap-2, so four counted tabs fit a 400px list pane. Strips 32rem and wider keep px-6 and gap-6, and a strip that grows after mount gets the wide spacing back. A strip that still overflows keeps the edge fade at the cut side.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Compact page header puts the status under the title
detail: At phone width the header status slot moves to its own small line below the page title instead of sharing the row with it, so the title no longer truncates while it fits alone. Secondary actions stay in the overflow menu as before.
-->
