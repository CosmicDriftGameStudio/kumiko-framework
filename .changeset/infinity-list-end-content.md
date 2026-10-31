---
"@cosmicdrift/kumiko-renderer": minor
---

InfinityList takes endContent, shown after the last row inside the scroll area.

<!-- kumiko-changes
feature: renderer
type: feature
title: InfinityList can end in content that scrolls with its rows
detail: New prop endContent renders after the last loaded row, inside the list's scroll container, for example a "not found what you were looking for?" hint right under search hits. It is not shown while the list shows its empty state; put such a hint into emptyState as well if it should appear there.
-->
