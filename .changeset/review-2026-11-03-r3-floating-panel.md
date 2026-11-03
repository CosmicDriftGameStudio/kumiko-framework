---
"@cosmicdrift/kumiko-renderer": patch
---

FloatingPanel in fixed placement no longer overflows the left viewport edge beside a sidebar.

<!-- kumiko-changes
feature: renderer
type: fix
title: fixed FloatingPanel width accounts for the right offset
detail: The fixed placement limited the width to `100vw` minus twice the margin and ignored `rightPx`, so a panel anchored beside a sidebar (for example `right: 364px` at a 768px viewport) lost its left edge, title and header actions. The width is now `min(widthPx, calc(100vw - (rightPx + margin)))`, like the height with `bottomPx`.
-->
