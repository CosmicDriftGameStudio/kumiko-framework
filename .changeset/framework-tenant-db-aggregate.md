---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

TenantDb.aggregate and aggregateWhere: grouped count, countDistinct, sum and avg with time buckets (fw#3396)

`tenantDb.aggregate(table, { measure, groupBy?, orderByValue?, limit? }, where?)` and the standalone `aggregateWhere(db, table, spec, where?)` run one grouped aggregate with the same tenant scoping as `read`/`count`. A dimension can be a plain column or a time bucket (`{ field, bucket: 'hour' | 'day' | ..., timeZone }`) on a timestamptz column; bucket keys come back as epoch milliseconds. Types live in `@cosmicdrift/kumiko-types/aggregate-types`. Unknown fields, non-timestamptz bucket columns and bad limits throw before any SQL runs.

<!-- kumiko-changes
feature: framework
type: improvement
title: TenantDb.aggregate and aggregateWhere: grouped count, countDistinct, sum and avg with time buckets (fw#3396)
migration: |
  Only code that implements the `TenantDb` interface itself (for example a hand-written mock) must add an `aggregate` method; `createTenantDb` already provides it.
-->
