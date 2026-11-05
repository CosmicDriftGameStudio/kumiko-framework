---
"@cosmicdrift/kumiko-renderer": patch
---

Detail pages no longer show two h1 for a moment, and the `warn` stat tone uses the status-warn token.

<!-- kumiko-changes
feature: renderer
type: fix
title: detail pages show one h1 at a time, stat warn tone uses status-warn
detail: DefaultPageHeader sets the bodyTitle flag in a layout effect, so the shell breadcrumb no longer paints its own h1 next to the page's h1 under a slow CPU. The `warn` tone of StatCard, StatStripCell and MiniStat used the destructive color; it now uses `status-warn` and `status-warn-surface` like the other widgets.
-->
