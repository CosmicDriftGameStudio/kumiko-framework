---
"@cosmicdrift/kumiko-renderer": patch
---

Infinite entity lists keep showing live changes to their first page after more pages were loaded, and a write no longer jumps them back to the top.

<!-- kumiko-changes
feature: renderer
type: fix
title: Infinite lists stay live after loading more pages
detail: A list with `pagination: "infinite"` keeps its first page as the live query and loads further pages separately. A live event refreshes the first page and merges it into the loaded rows: changed rows update, rows deleted or filtered out of the first page disappear, and rows of later pages stay. Before, a live event after the first load-more only refetched the last page, so changes and deletions on earlier rows never arrived. After a write action the list reloads exactly the pages it has loaded instead of resetting to page 1, so the scroll position and the rows beyond page 1 stay up to date. `InfinityList` uses the same merge helpers and the shared live refetch scheduler; its behavior is unchanged.
-->
