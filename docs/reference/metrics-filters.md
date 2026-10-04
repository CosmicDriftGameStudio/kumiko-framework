---
status: reference
verified: 2026-10-04
evidence: "packages/bundled-features/src/metrics/types.ts (MetricDefinition.filters, MetricFilterResolver); packages/bundled-features/src/metrics/filters.ts; packages/bundled-features/src/metrics/validate.ts; packages/bundled-features/src/metrics/__tests__/metrics-filters.integration.test.ts"
---

# Metrics filters

A metric query (`metrics:query:<id>` or `metrics-system:query:<id>`) normally aggregates the whole tenant. `filters` lets the caller narrow it with payload values, for example to one folder.

```ts illustration
defineMetric({
  id: "files-count",
  description: "Active files, narrowable by folder",
  source: filesTable,
  measure: { fn: "count" },
  where: { archived: false },
  filters: { folderId: "folderId" },
  scopes: ["tenant"],
});
```

Each entry maps a payload key to a source column. The query then accepts `{ folderId: "<uuid>" }` next to `range` and `timeZone` and adds `folderId = <value>` to the where clause. An empty string or `null` means no filter. A dashboard panel passes the value through its `params` or the screen filter like any other query param.

## Resolver filters

When the payload value does not map to one column value, use a `MetricFilterResolver`. A folder filter that includes subfolders is the typical case:

```ts illustration
filters: {
  folderId: {
    column: "loanId",
    valueKind: "uuid",
    resolve: async (folderId, ctx) => loanIdsInFolderTree(ctx, folderId),
  },
},
```

`resolve` runs with the tenant handler context, so its reads are tenant scoped. The returned values become an `IN` list on `column`. An empty list matches no rows. `valueKind` describes the payload value (`"uuid"`, `"number"` or `"string"`, default `"string"`) and drives payload validation.

Resolver filters work only on metrics without the `"system"` scope. The boot validation fails otherwise, because a system metric has no tenant context to resolve with.

## Tenant isolation

Filters only narrow. The handler builds the where clause from the metric's `where`, then the filters, then the tenant scope, so the scope always wins and a payload cannot reach another tenant's rows. The integration tests cover this with two tenants.

## Validation at boot

A metric fails boot when a filter key is not camelCase, uses a reserved payload key (`range`, `timeZone`, `tenantId`), points at a missing column or at `tenantId`, repeats a column the metric's own `where` already fixes, or points at a column that is not uuid, text or a number type. A numeric filter accepts a number or a numeric string in the payload.
