---
status: reference
verified: 2026-11-17
evidence: "entity-write-patterns.md (#498, #1208, #1220); WELLE-3 PR 4"
---

# Persistence: table kinds, database handles, append roles

Which table kind a feature declares decides whether a projection rebuild can
reconstruct it. Details and failure modes: [entity write patterns](entity-write-patterns.md).

## Table kinds

| Kind | Declared with | Written via | Rebuild | Direct writes |
|---|---|---|---|---|
| Event-sourced | `r.entity`, `r.projection`, `r.multiStreamProjection`, `r.extendEntityProjection` | Executor, `ctx.events.append`, projection `apply` | Replays the event log into a shadow table and swaps it in | Forbidden: the rebuild drops them |
| Store table | `r.storeTable(meta, { reason })` | `insertOne`, `updateMany`, `deleteMany` on the table | Not a rebuild target | Allowed; the feature owns tenant scoping and retention |
| Unmanaged table | `defineUnmanagedTable({ tableName, columns })` | Whatever the owning code does (no executor, no audit trail) | Not a rebuild target | Allowed; register it with `r.storeTable` if a feature owns it |

`read_` is reserved for event-sourced tables. Store and unmanaged tables use another
prefix, `store_` by convention.

`deriveEntityTableMeta` turns an entity into table meta.

## Database handles on `HandlerContext`

| Handle | Scope | Survives a rollback of the handler transaction |
|---|---|---|
| `db` | Tenant-scoped, bound to the handler transaction | No |
| `ctx.db.outsideTransaction` | Tenant-scoped, own pool, every statement commits alone | Yes |
| `systemDb` | Only in `r.systemScope()` handlers; cross-tenant access needs `assertTenantMatch` or `acknowledgeCrossTenant`. `systemDb.outsideTransaction` is the matching outside-transaction pair | `outsideTransaction`: yes |

For an atomic write outside the handler transaction, pass `ctx.db.outsideTransaction` to
`runInOwnTransaction` from `@cosmicdrift/kumiko-framework/db`.

## Append roles

| Function | Role | On a version conflict |
|---|---|---|
| `ctx.events.append` | Default; typed payload | Throws and poisons the transaction |
| `ctx.events.tryAppend` | Optimistic; runs in a savepoint | Returns the conflict as a result |
| `ctx.events.unsafeAppend` | Untyped payload for runtime-pluggable events | Throws and poisons the transaction |
| `emitEvent(ctx, eventDef, …)` | Typed against the `EventDef`; the typed way onto `unsafeAppend` | Throws and poisons the transaction |

Every append states what it expects of the stream: `expectedVersion` or `blindAppendReason`.
Read `ctx.events.streamVersion(aggregateId)` before you read any state and pass it as
`expectedVersion` (the next append in the same handler uses +1); a stream you create in the
handler uses `0`. A concurrent append then fails with `version_conflict` instead of landing
on top. `blindAppendReason` is a concrete sentence for an event that stays valid whatever was
appended meanwhile; placeholders such as "todo" are rejected. An append with neither field,
or with a negative or non-integer `expectedVersion`, throws `internal_error`. "unsafe" only
means an untyped payload.

## Soft-delete and rebuild

The executor writes `deletedAt`, `deletedById` and `version` directly, and the implicit
entity projection derives the same values from the generic `deleted` and `restored`
events. A rebuild therefore returns the identical row for soft-deleted and restored
entities; `soft-delete-rebuild.integration.test.ts` and
`implicit-projection-equivalence.integration.test.ts` pin this. The lifecycle applies (`created`, `updated`, `deleted`, `restored`, `forgotten`) are fixed. An `r.extendEntityProjection` key for `<entity>.deleted` is a boot error, and an `apply` for it in an own `r.projection` runs in addition to the default and does not replace it. To set extra columns when an entity is deleted, append an own domain event and map it with an `r.projection` on the entity table: it runs live in the write transaction and the rebuild replays it. `r.extendEntityProjection` is only for writers that deliver live on their own, such as a multi-stream projection.
