---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-types": patch
---

Dashboard and list design options, all opt-in. The one default change: number and currency columns in dashboard list panels are right-aligned and do not wrap.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Dashboards and lists gain opt-in design options for sub-line tone, unframed stat cards, bar chart details, segment rows, header subtitle and boolean pills
detail: Stat panels take `subToneField` (a stat tone: default, positive, ok, warn or negative) to color the sub line. A stat-group takes `framed: false` (with layout cards, no label, subtitle or link) to draw separate cards without the outer frame, each with its sub line under the value. A stacked-bars chart takes `barValueLabels`, `highlightLast`, `hideYAxis`, `hideLegend`, `labelEveryBucket` and `lastBucketLabel: "date"`; a segment-bars chart takes `layout: "rows"`, `hideLegend` and `singleTone` (one tone for all dynamic segment keys, not with seriesTones or seriesColors). The `currency` format takes `amountIn: "major"` for whole-unit amounts, the `unit` format takes `minimumFractionDigits` and `maximumFractionDigits`. A dashboard takes `showTitle: true` for the screen title as page heading, `sideWidth: "wide"` for a 2/5 side column in main-side, and `headerSubtitle: { query, field }` to show a dynamic line under the title. A rowAction takes `inMenu: false` to stay out of the row menu. A dashboard list panel right-aligns number and currency columns and keeps them on one line. The boolean list format takes `trueTone` and `falseTone` (each needs its label) to draw a status pill.
-->
