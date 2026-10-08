---
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

Stacked-area charts get a brush to drag the visible window, and the widget takes range presets itself

The `stacked-area` dashboard panel accepts `brush: true`: a scrubber under the plot shows the whole series and lets the user drag or resize the visible window. Without `ranges` the window starts at today. A dragged window deselects the range switch, a range click resets the brush. The exported `StackedAreaChart` widget takes `ranges` and `brush` directly and renders its own range switch, so an app chart sets two props instead of carrying window logic. Panels and widgets without the new props render as before.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: The stacked-area panel and the StackedAreaChart widget accept brush and ranges, with the window anchored at today
-->
