---
"@cosmicdrift/kumiko-renderer-web": minor
---

TimeseriesChart and StackedAreaChart draw a single value; LanguageSwitcher takes triggerContent

`TimeseriesChart` and `StackedAreaChart` show `emptyContent` only when there is no value at all. With exactly one value they draw a point at the horizontal centre with the y-scale widened around it, so it no longer sits on the edge. `LanguageSwitcher` takes `triggerContent: "code" | "label" | "icon-only"` (default `"code"`); `"label"` shows the label of the active locale in the trigger. `aria-label` and `title` are unchanged.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Single-value timeseries point and LanguageSwitcher triggerContent
-->
