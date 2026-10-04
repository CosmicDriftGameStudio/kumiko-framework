---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Dashboard panel gates, stat-group subtitle, progress sub line, stacked-area lines, marker kinds and ranges

`stat`, `stat-group`, `chart`, `list`, `feed` and `progress-list` panels take `visibleWhen` (`DashboardPanelGate`), like `screen` panels. The gate query gets the screen filter and time range. The panel renders nothing while the gate loads or is unmet, and shows an error with retry when the gate query fails. Panels with the same gate query and payload share one live request. The boot validator checks the gate query and field and rejects `visibleWhen` on stat-group children.

A labeled `stat-group` takes a `subtitle`. In an unlabeled group (KPI strip) each child keeps its `icon` and `accentColor`. `progress-list` rows take an optional `sub` (`DashboardText`) shown under the bar.

`stacked-area` results can carry `lines` (`{ key, label, points, dashed? }`, drawn unstacked over the bands) and `markers[].kind`. New chart options: `seriesColors` (key to CSS color, wins over `seriesTones`), and only for stacked-area `markerKinds` (kind to `{ tone }` or `{ color }`: colored pin plus dashed guide line), `legendTotals: false` and `ranges` (a range switch in the panel header that windows bands, lines and markers by `months`). `StackedAreaChart` gets `lines`, `colors` and `showLegendTotals`; `ChartMarker` gets `color`.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Dashboard panels take visibleWhen; stat-group subtitle and strip icons, progress-list sub line, stacked-area lines, markerKinds, seriesColors, legendTotals and ranges
-->
