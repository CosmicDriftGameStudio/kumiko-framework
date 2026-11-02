---
"@cosmicdrift/kumiko-renderer": patch
---

`InfinityList` live refresh no longer lets a superseded run re-query or leak state across effect restarts.

<!-- kumiko-changes
feature: renderer
type: fix
title: InfinityList live refresh state is local to its effect
detail: The disposed, in-flight and trailing flags of the live first-page refresh belong to one effect run, so a payload change or unmount no longer lets the previous run schedule another query.
-->
