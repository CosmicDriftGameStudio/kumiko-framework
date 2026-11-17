---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`TenantDb.aggregate` gets `min`, `max` and `percentile` measures and refuses non-numeric measure columns with a clear error.

<!-- kumiko-changes
feature: framework
type: improvement
title: Aggregate measures min, max and percentile
detail: `ctx.db.aggregate` accepts `{ fn: "min" | "max", field }` and `{ fn: "percentile", field, fraction }` (continuous percentile, `fraction` between 0 and 1, e.g. 0.95 for p95) next to count, countDistinct, sum and avg, also per field or per hour or day bucket. Over zero rows they return null. sum, avg, min, max and percentile need a numeric column (integer, bigint, double precision, numeric) and throw `aggregateWhere: <fn> needs a numeric column` instead of a Postgres error. A metric with a min, max or percentile measure leaves empty buckets null, like avg, instead of filling them with 0.
-->
