---
"@cosmicdrift/kumiko-renderer-web": minor
---

TimeseriesChart: height, y-axis gridlines and a date axis

`height` (px) replaces the fixed `h-16`; without it the chart looks as before. `yAxis: { ticks, format? }` draws that many gridlines with rounded value labels (0/200/400/600) in a left gutter, and the y-scale reaches the top tick. `xAxis: { ticks, format }` renders n evenly spaced date labels instead of the fixed start/mid/end of `axisLabels`.

<!-- kumiko-changes
feature: renderer
type: improvement
title: TimeseriesChart takes a height, an optional y-axis with gridlines and a date axis with n labels
-->
