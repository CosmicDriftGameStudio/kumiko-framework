---
"@cosmicdrift/kumiko-renderer": patch
---

A table's bulk selection is now dropped when a filter yields an empty list, and the selection limit counts only loaded rows.

<!-- kumiko-changes
feature: renderer
type: fix
title: bulk selection no longer keeps hidden rows after an empty result
detail: `useRowSelection` skipped pruning whenever the list was empty, so rows selected before a filter hit zero results reappeared selected once the filter was lifted, and hidden ids counted toward the 100-row limit. Pruning now only skips the empty gap right after a bulk run retained its failed rows, and `isFull` and the toggle limit count loaded rows only.
-->
