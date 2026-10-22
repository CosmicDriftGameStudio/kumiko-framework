---
"@cosmicdrift/kumiko-framework": patch
---

The list read verb, the column builder for entity fields, the derivation of entity table metadata and the per-table migration diff are split into small named steps. Generated SQL, list results, table metadata and migration plans are unchanged.

<!-- kumiko-changes
feature: framework
type: improvement
title: Named steps for list reads, field columns, table metadata and table diffs
detail: The list read verb runs search, sort, cursor boundary, filters, stream-version projection, row rehydration and the next cursor as named steps in their own files next to event-store-executor-read.ts, and detail() shares the ownership and row rehydration steps. Field columns come from one emitter per field type in a typed table, so a new field type fails the typecheck until it has an emitter, and an unknown type from untyped input still throws "unhandled field type". deriveEntityTableMeta collects columns, foreign-key, blind-index and declared indexes in separate steps with the same overloads and error texts. diffOneTable compares columns and indexes through one comparator per kind and keeps the order of added, dropped and changed entries.
-->
