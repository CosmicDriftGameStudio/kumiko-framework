---
"@cosmicdrift/kumiko-renderer-web": patch
---

Chart tick, tooltip, marker and brush fixes; dashboard visibility gates no longer remount the grid

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Chart ticks, tooltip, markers and brush behave correctly; filter changes no longer reset panel state
detail: Fractional y-axis ticks no longer show float noise such as 0.6000000000000001, and the stacked-area grid lines share the tick values of the y labels. A lone bucket with a zero total shows the empty content again. The hover card is tracked by time, so it stays on its date when the window shifts and closes once that date is gone; it also stays inside narrow plots, and the outside-click listeners are no longer re-attached on every bucket change. With markerLabels the numbered marker list is hidden on wide containers together with the pins. Line legend entries get their own key and test id (chart-legend-line-<key>) so a line sharing a key with a series no longer collides. Moving the brush window keeps its width in buckets across uneven month lengths, and a range anchored before the first bucket falls back to the full window. Axis ticks are memoized and day ticks step by calendar days. Dashboard visibility gate queries now run as keyed siblings of the grid, so a filter change that adds or removes a gate no longer remounts all panels and drops local state such as the chart range selection.
-->
