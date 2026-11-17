---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

Dashboard panels read one field of a shared query answer with `resultField`, so several panels load with one request.

<!-- kumiko-changes
feature: framework
type: improvement
title: Dashboard panels share one query through resultField
detail: Every query-backed dashboard panel (stat, stat-group child, chart, list, feed, progress-list, text) takes `resultField`. The panel reads `answer[resultField]` instead of the whole answer, so one screen query that returns for example `{ stats, recent, deadlines }` can feed several panels. Panels with the same `query` and the same merged params share one request on load, on refresh, on live events and on refetchAll; a panel with its own `params` or `ignoreScreenFilter` keeps its own request. Boot validation checks that `resultField` names a field of the query's outputSchema and checks the panel's fields (valueField, columns, row links) against that field's schema. The dashboard-stats recipe shows an overview screen fed by one query.
-->
