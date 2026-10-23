---
"@cosmicdrift/kumiko-renderer": patch
---

DataTable cards on narrow screens keep the title on one line and the row menu inside the viewport.

<!-- kumiko-changes
feature: renderer
type: fix
title: DataTable card title is truncated instead of wrapping
detail: In the mobile card layout a long title now truncates to one line with its full text on hover, and the row-actions menu no longer shrinks or leaves the viewport next to it. Before, the title wrapped over several lines and could squeeze the menu.
-->
