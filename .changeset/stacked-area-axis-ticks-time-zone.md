---
"@cosmicdrift/kumiko-renderer-web": patch
---

Stacked-area x-axis ticks align to month and day starts in the user's time zone

<!-- kumiko-changes
feature: renderer-web
type: fix
title: StackedAreaChart axis ticks use the user's time zone instead of UTC
detail: stackedAreaAxisTicks takes a timeZone and computes month and day starts there; StackedAreaChart takes a matching timeZone prop (default UTC) and the dashboard panel passes the resolver's zone. In zones west of UTC the January tick no longer reads December and day ticks no longer show the previous day.
-->
