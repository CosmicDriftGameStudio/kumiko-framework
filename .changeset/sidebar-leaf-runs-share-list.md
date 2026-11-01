---
"@cosmicdrift/kumiko-renderer": patch
---

Top-level sidebar entries without a section now sit at the same spacing as entries inside a section.

<!-- kumiko-changes
feature: renderer
type: fix
title: Consecutive top-level nav entries without a section share one list
detail: NavTree rendered every top-level entry that is not a section (screen leaves, provider nodes such as Content) in its own list, so the 12px gap between blocks also opened between two such entries. Consecutive entries now form one list with the 1px item gap; only sections and runs of entries are separated by the block gap. A run whose entries are all filtered out by the search is hidden.
-->
