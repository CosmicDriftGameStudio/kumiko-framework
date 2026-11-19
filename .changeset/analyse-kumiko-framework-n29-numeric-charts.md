---
"@cosmicdrift/kumiko-renderer": patch
---

`@cosmicdrift/kumiko-renderer/web` exports StackedAreaChart and four numeric charts: NumericLineChart, SignedBarChart, HistogramChart and DivergingBarChart.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Numeric line, signed bar, histogram and diverging bar charts
detail: Apps no longer need a chart library for numeric axes. NumericLineChart draws several series over a numeric x axis (for example years) with y ticks, horizontal or vertical reference lines and a `renderTooltip(x)` slot. SignedBarChart stacks positive values above and negative values below a zero line. HistogramChart draws numeric bins with x and y ticks and vertical reference lines such as breakeven. DivergingBarChart draws signed horizontal bars around zero, sorted by absolute value (tornado chart). StackedAreaChart and its types (ChartSeries, ChartMarker, ChartLine, StackedAreaRanges) are now exported from `@cosmicdrift/kumiko-renderer/web`.
-->
