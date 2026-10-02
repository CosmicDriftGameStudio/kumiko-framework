---
"@cosmicdrift/kumiko-renderer-web": patch
---

The FloatingPanel grip button drags the panel with the pointer again. Drawer passes `style` as `undefined` when no width or offset applies. Image resize releases the decoded bitmap when no 2d context is available. Nav tree actions that set both `screen` and `target` warn once that `target` is ignored.

<!-- kumiko-changes
feature: renderer
type: fix
title: FloatingPanel grip pointer drag, Drawer style undefined, resize bitmap release, nav action screen+target warning
-->
