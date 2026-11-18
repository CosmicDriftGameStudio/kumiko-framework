---
"@cosmicdrift/kumiko-renderer": patch
---

The first and last x-axis labels of the numeric charts stay inside the plot instead of overflowing half their width.

<!-- kumiko-changes
feature: renderer
type: fix
title: Numeric chart edge tick labels stay inside the plot
detail: `NumericLineChart`, `SignedBarChart` and `HistogramChart` centered every x-axis label on its tick, so the labels at the left and right edge stuck out of the plot by half their width and could be clipped. The first label now starts at its tick and the last one ends at it; labels in between and a single label stay centered.
-->
