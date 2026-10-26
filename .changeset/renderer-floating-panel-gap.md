---
"@cosmicdrift/kumiko-renderer": patch
---

FloatingPanel keeps at least 16px to every viewport edge, and a panel docked to the right or bottom edge keeps its distance to that edge when the window changes size.

<!-- kumiko-changes
feature: renderer
type: fix
title: Floating panel keeps its distance to the window edge
detail: Moving, resizing and window resizes clamp the panel 16px inside the viewport instead of at the border. On a window resize the panel keeps its gap to the nearer horizontal and vertical edge, so a bottom-right panel no longer sticks to the right border when the window narrows. Stored geometry stays valid and is only clamped again.
-->
