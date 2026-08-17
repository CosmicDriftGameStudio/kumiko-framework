---
"@cosmicdrift/kumiko-framework": patch
---

The boot-validator now checks that every screen-level query QN (`projectionList.query`, `projectionDetail.query`, `relatedList.query`, dashboard panel/stat-group-child `query`, and dashboard `filter.optionsQuery`) resolves to a query-handler actually registered via `r.queryHandler(...)` — mirroring the existing write-handler existence check on row/toolbar actions. A typo in a query QN now fails at boot instead of surfacing only when the screen is opened.
