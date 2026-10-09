---
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Stacked-area charts and panels pick the date format by span, can start at today regardless of the default range, scale the y axis finer and list markers in the legend

- `dateFormat` ("day" | "month"): automatic by visible window, month and year from 18 months, day and month below; `formatBucketLabel` and `formatMarkerTime` receive the format as second argument.
- `initialWindow` ("default-range" | "from-today"): "from-today" starts at today even with `ranges.default` set; the range switch then shows no active pill.
- The y scale rounds up in finer steps (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8), so 1.1 million tops out at 1.2 million instead of 2 million.
- `markerLegend` ("list" | "legend") with `DashboardChartMarkerKind.label` and `ChartMarker.legendLabel`: unnumbered pins with tooltip and one dashed legend entry per marker kind. Boot validation checks the new props, the marker kind labels are required i18n keys.
- `@cosmicdrift/kumiko-bundled-features/tenant-lifecycle/testing` exports `runTenantDestructionSweep`, `seedDestroyingTenant` and `driveDestructionToCompletion` for destroy tests.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: StackedAreaChart and the stacked-area dashboard panel take dateFormat, initialWindow and markerLegend and round the y scale in finer steps
-->

<!-- kumiko-changes
feature: tenant-lifecycle
type: improvement
title: tenant-lifecycle/testing exports runTenantDestructionSweep, seedDestroyingTenant and driveDestructionToCompletion
-->
