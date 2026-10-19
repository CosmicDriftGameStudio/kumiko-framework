---
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

TimeseriesChart shows the y-axis unit once and takes a per-viewport height

`TimeseriesYAxis` gains `unit`: the ready-to-display unit is drawn once above the tick labels (test id `<testId>-y-unit`) while the ticks show only `format(tick)`. `TimeseriesChart` `height` also accepts `{ narrow, wide, narrowBelowPx? }` (default breakpoint 768) and picks the value from the viewport. The new `useIsViewportBelow(breakpointPx)` hook backs this; `useIsNarrowViewport` is now built on it.

`DashboardChartPanel` gains `unit` (i18n key, chart `timeseries` only): the dashboard renders the y axis for it even without `valueFormat`. The boot validator rejects `unit` on other chart kinds, and a `unit` key without a translation fails the required-surface key check like `subtitle`.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: TimeseriesChart y-axis unit shown once and viewport-dependent height
detail: TimeseriesYAxis.unit renders the unit once above the y ticks instead of on every tick label. TimeseriesChart height accepts { narrow, wide, narrowBelowPx? } (default 768). New exported hook useIsViewportBelow(breakpointPx).
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Dashboard chart panels take a y-axis unit
detail: DashboardChartPanel.unit (i18n key) is shown once on the y axis of a timeseries chart, with or without valueFormat. The boot validator rejects unit on other chart kinds; an untranslated unit key fails the required-surface key check.
-->
