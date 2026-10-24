---
status: reference
verified: 2026-10-19
evidence: "entity-write-patterns.md (#498, #1208, #1220); WELLE-3 PR 4"
---

# Persistence: table kinds, database handles, append roles

Which table kind a feature declares decides whether a projection rebuild can
reconstruct it. Details and failure modes: [entity write patterns](entity-write-patterns.md).

## Table kinds

| Kind | Declared with | Written via | Rebuild | Direct writes |
|---|---|---|---|---|
| Event-sourced | `r.entity`, `r.projection`, `r.multiStreamProjection`, `r.extendEntityProjection` | Executor, `appendEvent`, projection `apply` | Replays the event log into a shadow table and swaps it in | Forbidden: the rebuild drops them |
| Store table | `r.storeTable(meta, { reason })` | `insertOne`, `updateMany`, `deleteMany` on the table | Not a rebuild target | Allowed; the feature owns tenant scoping and retention |
| Unmanaged table | `defineUnmanagedTable({ tableName, columns })` | Whatever the owning code does (no executor, no audit trail) | Not a rebuild target | Allowed; register it with `r.storeTable` if a feature owns it |

`read_` is reserved for event-sourced tables. Store and unmanaged tables use another
prefix, `store_` by convention.

`deriveEntityTableMeta` turns an entity into table meta.

## Database handles on `HandlerContext`

| Handle | Scope | Survives a rollback of the handler transaction |
|---|---|---|
| `db` | Tenant-scoped, bound to the handler transaction | No |
| `dbOutsideTransaction` | Tenant-scoped, own pool, every statement commits alone | Yes |
| `systemDb` | Only in `r.systemScope()` handlers; cross-tenant access needs `assertTenantMatch` or `acknowledgeCrossTenant`. `systemDb.outsideTransaction` is the matching outside-transaction pair | `outsideTransaction`: yes |

For an atomic write outside the handler transaction, pass `ctx.db.outsideTransaction` to
`runInOwnTransaction` from `@cosmicdrift/kumiko-framework/db`. The `ctx.outsideTransaction`
function is a deprecated shortcut for that.

## Append roles

| Function | Role | On a version conflict |
|---|---|---|
| `appendEvent` | Default; typed payload | Throws and poisons the transaction |
| `tryAppendEvent` | Optimistic; runs in a savepoint | Returns the conflict as a result |
| `unsafeAppendEvent` | Untyped payload; for migrations and upcasters | Throws and poisons the transaction |

## Soft-delete and rebuild

The executor writes `deletedAt`, `deletedById` and `version` directly, and the implicit
entity projection derives the same values from the generic `deleted` and `restored`
events. A rebuild therefore returns the identical row for soft-deleted and restored
entities; `soft-delete-rebuild.integration.test.ts` and
`implicit-projection-equivalence.integration.test.ts` pin this. A custom `apply` handler for
`<entity>.deleted` replaces that default, so it has to set the same columns.
