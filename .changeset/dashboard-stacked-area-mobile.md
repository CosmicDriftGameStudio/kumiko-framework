---
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

Dashboards keep their width at 390 px and the stacked-area chart reads better

The dashboard grid has an explicit single column on narrow screens and its cells can shrink, so a wide panel no longer stretches the page. The panel header wraps: title, subtitle and range switch stack instead of squeezing into one row. The KPI strip delta chip no longer wraps, it moves below the label when space is short. Stacked-area charts get a taller plot, a compact y axis ("1,5 Mio. €"), dashed grid lines, calendar-aligned x-axis ticks that thin out with the container width, and larger brush handles (24 px hit area). New panel option `markerLabels` writes marker labels vertically next to their guide lines on wide panels; narrow ones keep numbered pins with a list below. Labeled stat groups now wrap their cards instead of overflowing when values are wide (e.g. 2 + 1 instead of 3 columns).

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Dashboards fit 390 px screens; stacked-area chart gets compact axis, grid lines, x ticks and markerLabels
-->
