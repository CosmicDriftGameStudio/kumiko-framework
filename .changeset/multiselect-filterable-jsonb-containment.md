---
"@cosmicdrift/kumiko-framework": patch
---

Fix `filterable: true` on `multiSelect` fields crashing (or, depending on Postgres/driver version, silently returning wrong rows) at query time. A `multiSelect` field stores its options as a jsonb array, so `eq`/`ne`/`in` filters now use jsonb containment (`@>`) instead of scalar `=`/`<>`/`IN` against the array column — fixed in both the screen-filter WHERE builder (`EventStoreExecutor.list()`) and the generic `selectMany`/`fetchOne`/etc. query API (`buildWhereClause`). `lt`/`gt` on a `multiSelect` column remain unsatisfiable (no containment analogue) and now resolve to an empty result instead of invalid SQL.
