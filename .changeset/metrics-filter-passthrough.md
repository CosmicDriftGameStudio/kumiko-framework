---
"@cosmicdrift/kumiko-bundled-features": minor
---

metrics: payload filters on a metric

`MetricDefinition.filters` maps payload keys to source columns, e.g. `{ folderId: "folderId" }`. The metric query then accepts that key and narrows the aggregate to the value, for the current and previous window and for groups, stacks and series. The tenant scope is applied last, so a filter value from another tenant yields 0, never that tenant's numbers. `""`, `null` and a missing key mean no filter. The value type follows the column (uuid, numeric, text); an invalid value is a 400. Definitions are rejected at boot for non-camelCase keys, the reserved keys `range`/`timeZone`/`tenantId`, unknown columns, the tenant column, columns already fixed by `where`, and column types other than uuid, text and numeric.

A filter can also be a resolver `{ column, resolve(value, ctx), valueKind? }`: the payload value (e.g. a folder id) is mapped to the allowed values of `column` through the tenant handler context (IN filter, empty result = no rows), for assignments that live in another table. Resolvers are rejected on metrics with scope `system`.

<!-- kumiko-changes
feature: metrics
type: improvement
title: Metrics accept payload filters that narrow the aggregate without replacing the tenant scope
-->
