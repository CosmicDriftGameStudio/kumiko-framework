---
"@cosmicdrift/kumiko-renderer-web": minor
---

`TimeseriesChart` accepts an optional `referenceLines` prop that draws dashed horizontal threshold lines (for example a p95 or an SLO target) with an accessible label. A line above the data maximum extends the y-scale.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: TimeseriesChart draws optional reference lines
migration: |
  No code change needed. Pass `referenceLines={[{ value, label, tone }]}` to draw a dashed threshold such as p95 or an SLO target.
-->
