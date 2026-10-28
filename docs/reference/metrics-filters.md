---
status: reference
verified: 2026-10-28
evidence: "packages/bundled-features/src/metrics/types.ts (MetricDefinition.filters, MetricFilterResolver, access, groupLabelsFrom); packages/bundled-features/src/metrics/__tests__/metrics-access-labels.integration.test.ts; packages/bundled-features/src/metrics/filters.ts; packages/bundled-features/src/metrics/validate.ts; packages/bundled-features/src/metrics/__tests__/metrics-filters.integration.test.ts"
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

## Access and group names

`access: { roles: ["Staff"] }` replaces the default admin-only access of the tenant query with the listed roles, for dashboards that non-admins may see. An empty list fails boot. Metrics with scope `"system"` stay SystemAdmin only.

`groupLabelsFrom: { source, labelField }` names the `groupBy` rows after the referenced row instead of showing its id. The keys are ids of `source`, read in one query through the caller's tenant-scoped db, so a row of another tenant is never resolved and its key stays the label. A static `groupLabels` entry wins. `stackBy` keys are not resolved.

## Tenant isolation

Filters only narrow. The handler builds the where clause from the metric's `where`, then the filters, then the tenant scope, so the scope always wins and a payload cannot reach another tenant's rows. The integration tests cover this with two tenants.

## Validation at boot

A metric fails boot when `groupLabelsFrom` has no `groupBy` or names a column the source does not have, or when a filter key is not camelCase, uses a reserved payload key (`range`, `timeZone`, `tenantId`), points at a missing column or at `tenantId`, repeats a column the metric's own `where` already fixes, or points at a column that is not uuid, text or a number type. A numeric filter accepts a number or a numeric string in the payload.
