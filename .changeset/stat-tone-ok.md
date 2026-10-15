---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Dashboard stat panels and `StatCard` accept the tone `ok` (status green) next to `positive`, which keeps following the theme primary color. `toneField` results of `"ok"` are honoured.

<!-- kumiko-changes
feature: types
type: improvement
title: Stat tone "ok"
detail: DashboardStatPanel.tone accepts "ok" for a status-green value.
-->

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Stat tone "ok"
detail: StatCard and dashboard stat panels render tone "ok" with the status-ok tokens, also via toneField. An app-side exhaustive Record<StatTone, …> needs an "ok" entry.
-->
