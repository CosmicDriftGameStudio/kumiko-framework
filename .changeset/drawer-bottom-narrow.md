---
"@cosmicdrift/kumiko-renderer": patch
---

A `Drawer` with `side="bottom"` stays a bottom sheet on a phone and keeps its `panelClassName` there.

<!-- kumiko-changes
feature: renderer
type: fix
title: Bottom drawers stay docked on narrow viewports
detail: Below the narrow breakpoint every Drawer went full-screen and ignored `side`. With `side="bottom"` the panel now stays at the bottom edge with the dimmed page behind it. Other sides keep the full-screen layout.
-->
