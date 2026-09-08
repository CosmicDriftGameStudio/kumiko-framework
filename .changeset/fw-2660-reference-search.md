---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

Reference fields can now opt into text search matching by their target row's label instead of the raw FK column: add `searchable: true` to a `ReferenceFieldDef` alongside an explicit, non-`"id"` `labelField`. A search request unions native text-field hits with tenant-scoped label matches against the reference target (and the implicit `tenantId` → `tenant.name` row-meta reference), capped at 200 target matches — above that the reference clause is dropped and native search still applies.

Also removes the unused `searchInclude` option from `r.relation()`'s `belongsTo`/`manyToMany` definitions and `Registry.getSearchIncludes` (replaced by `Registry.getSearchableReferences`) — that mechanism had no production consumers.
