---
"@cosmicdrift/kumiko-renderer-web": patch
---

Fix `Drawer` with `variant="flush" belowHeader` on `side="left"|"right"`: the panel used `h-full` (100% viewport height) together with the header-offset `top`, pushing its bottom edge (and any footer slot) past the viewport. It now switches to `h-auto` so the panel's height follows the top/bottom insets instead, keeping the bottom edge on-screen.
