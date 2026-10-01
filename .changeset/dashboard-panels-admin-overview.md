---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
---

Dashboard screens get new chart kinds, panel states and a time range; admin-shell overviews are built from metrics

Dashboard panels gain the chart kinds `stacked-bars`, `segment-bars` and `stacked-area`, a subtitle, per-series tones, static query `params`, `ignoreScreenFilter`, an empty label and hint, a `span` (half/full width), a stat `sparklineField` and static `tone`, a `negative` tone, an unlabelled `stat-group` KPI strip and bar/badge list columns. Every panel shows skeleton, empty and error states with retry. A screen can declare a `timeRange` control and a `scope` badge and notice. The admin-shell overview screens use all of this and show the metrics of the new `metrics` and `metrics-system` features. `deliveries-by-channel` now labels the email, in-app and push channels.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Dashboard screens get stacked-bars, segment-bars and stacked-area charts, panel states, time range, scope badge and bar/badge list columns
-->

<!-- kumiko-changes
feature: renderer-web
type: breaking
title: Dashboard screens show screen.description only when it is an i18n key; plain-text descriptions stay agent-facing and are no longer rendered
migration: |
  To keep a visible subtitle under a dashboard title, set screen.description to an i18n key (for example "my-feature:screen.overview.description") and register its translations.
-->

<!-- kumiko-changes
feature: metrics
type: fix
title: deliveries-by-channel shows readable channel labels instead of raw channel ids
-->

<!-- kumiko-changes
feature: admin-shell
type: breaking
title: admin-shell requires the metrics and metrics-system features and builds its overview dashboards from a metrics list
migration: |
  Mount createMetricsFeature({ metrics: DEFAULT_METRICS }) and createSystemMetricsFeature({ metrics: DEFAULT_METRICS }) from the metrics bundled feature before admin-shell. DEFAULT_METRICS also requires the delivery, sessions, jobs and tenant features.

  If you do not mount all of them, pass the same reduced list to all three: createMetricsFeature({ metrics }), createSystemMetricsFeature({ metrics }) and createAdminShellFeature({ metrics }). Overview panels exist only for metric ids in that list.
-->
