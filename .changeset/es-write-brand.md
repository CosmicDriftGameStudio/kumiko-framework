---
"@cosmicdrift/kumiko-framework": major
"@cosmicdrift/kumiko-bundled-features": patch
---

Make direct writes on event-sourced projections a compile error.

`EntityTable` is now branded (a phantom `unique symbol`), and the write helpers
`insertOne` / `insertMany` / `updateMany` / `deleteMany` / `deleteManyBatched` /
`upsertOnConflict` / `upsertByPk` / `incrementCounter` reject it: a managed
projection is writable only through the executor (event → rebuild-safe). Reads
are unchanged.

**Breaking:** any call that wrote a managed projection directly (e.g.
`deleteMany(ctx.db, myEntityTable, …)`) is now a type error. Migrate it to the
entity executor (`createEventStoreExecutor(...).update/.delete`), or — for a
table that is deliberately not event-sourced — declare it via `r.unmanagedTable`
so it is a plain `EntityTableMeta` (unbranded).

New: custom projection applies (`r.projection` / `defineApply`) receive the
projection table as a third argument — write through it instead of a closed-over
constant. Existing 2-arg applies keep working. Tests seed projection state via
the new `@cosmicdrift/kumiko-framework/testing` seam
(`seedRow`/`seedRows`/`updateRows`/`deleteRows`).

bundled-features: the user / fileRef / folder GDPR-forget hooks and the
user-session store now write rebuild-safely (executor events / unmanaged table)
— a projection rebuild no longer resurrects erased PII.
