---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

bun-db gains typed helpers for the cases that used to need raw SQL: `insertOnConflictDoNothing`, `selectInnerJoin`, a `jsonText` where operator for jsonb text fields and `orderByKeys` for `aggregateWhere`.

<!-- kumiko-changes
feature: framework
type: improvement
title: Typed bun-db helpers for insert-ignore, inner joins, jsonb text filters and key-ordered aggregates
detail: |
  `insertOnConflictDoNothing(db, table, values, { conflictKeys? })` returns the inserted row, or `undefined` when the conflict target already exists. `selectInnerJoin(db, { left, right, on, leftWhere?, rightWhere?, leftFields?, rightFields?, limit? })` joins two tables on one or more column pairs (casting to text only when the column types differ) and returns `{ left, right }` rows; `rightFields` defaults to none, so secrets on the joined table are only read when named. The where operator `jsonText: { keys, eq }` compares `col->>key` on jsonb columns, with several keys combined through `COALESCE`. `aggregateWhere` accepts `orderByKeys: "asc" | "desc"` to sort groups by their key before `limit`. All identifiers come from the table metadata and all values are bound parameters. The helpers refuse tenant-scoped tables like the other raw-connection helpers; use the `TenantDb` methods there.
migration: |
  keine
-->

<!-- kumiko-changes
feature: types
type: improvement
title: Where clauses and aggregate options describe jsonb text matches and key ordering
detail: |
  `WhereOperator` gains `jsonText?: JsonTextMatch | readonly JsonTextMatch[]` with `JsonTextMatch = { keys: readonly [string, ...string[]]; eq: string }`, and the aggregate options gain `orderByKeys?: "asc" | "desc"`.
migration: |
  keine
-->
