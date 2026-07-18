---
"@cosmicdrift/kumiko-framework": minor
---

Merge `r.rawTable()` and `r.unmanagedTable()` into a single `r.rawTable(meta, options)`.
Both registrars carried the same reason/audit contract and only differed in whether the
table value was a legacy Drizzle `PgTable` (`rawTable`) or the framework-native
`EntityTableMeta` (`unmanagedTable`, consumed by `migrate-runner`). Now that the
drizzle-cut has removed `PgTable` from the framework's own dialect, `r.rawTable()`
takes an `EntityTableMeta` — the result of `defineUnmanagedTable(...)` /
`buildEntityTableMeta(...)` — same as `r.unmanagedTable()` did. `r.unmanagedTable()` is
removed; call sites switch to `r.rawTable(meta, options)` with no other shape change.
