---
"@cosmicdrift/kumiko-renderer": patch
---

x-axis labels on the left or right edge of the numeric charts stay inside the plot instead of overflowing half their width.

<!-- kumiko-changes
feature: renderer
type: fix
title: Numeric chart edge tick labels stay inside the plot
detail: `NumericLineChart` and `HistogramChart` centered every x-axis label on its tick, so the labels at the left and right edge stuck out of the plot by half their width and could be clipped. A label exactly on the left edge now starts at its tick and one exactly on the right edge ends at it. Every other label stays centered, so a first or last tick inside the plot and the `SignedBarChart` labels under their bars keep their position.
-->
