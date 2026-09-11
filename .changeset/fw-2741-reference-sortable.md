---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

fw#2741: `ReferenceFieldDef` gains `sortable?: true`. A list sorted by such a field now orders by the referenced row's `labelField` instead of the FK column's UUID, resolved with a tenant-scoped correlated subquery on the read path (no join, no read-model change). Like `searchable`, the boot validator rejects `sortable` without an explicit non-`"id"` `labelField` and rejects it on `multiple` references. `Registry` gains `getSortableReferences(entityName)`, and `EventStoreExecutor.list`'s `runtimeOptions` gains a `referenceSort` counterpart to `referenceSearch`.

Behavior change: a `sort` on a reference field that did not opt into `sortable` (or whose target label cannot be resolved) now falls back to plain id order instead of ordering by the raw UUID column — a UUID order looks deliberate to the user while being arbitrary.
