---
status: reference
verified: 2026-06-30
evidence: "kumiko-framework#498 closed; infra#136; framework#523 #525"
---

# Entity write patterns: `r.entity` vs executor vs `r.unmanagedTable`

How to register a table and write to it so projection rebuilds do not silently
wipe live data.

## The failure mode (#498 / #494)

Every `r.entity` becomes a **rebuildable implicit projection**. On rebuild the
framework replays only lifecycle events (`<entity>.created/.updated/.deleted/
.restored`) into a shadow table and swaps it over the live table.

If handlers **direct-write** column state (`insertOne` / `updateMany` / … on the
entity table) **without** emitting matching lifecycle events, the replay finds
zero (or incomplete) events, builds an empty or stale shadow, and **replaces
the live table on deploy** — silent data loss.

Real instances: `read_users` GDPR state (#494), `read_user_sessions` mass-logout
(#523), user-data-rights sample `note`/`todo` tables (#525).

## Choose a pattern

| Pattern | Register with | Writes via | Rebuild |
|---|---|---|---|
| **Event-sourced entity** | `r.entity` | `createEventStoreExecutor(table, entity)` (or write handlers that call it) | Safe — replay reconstructs rows |
| **Direct-write store** | `r.unmanagedTable(meta, { reason })` | `insertOne` / `updateMany` / … on the table | Opted out — table is not a rebuild target |
| **Event-only projection** | `r.projection({ apply: (event, tx) => … })` | Writes inside `apply` / projection TX | Safe — derived from event stream |
| **Raw table (legacy)** | `r.rawTable` / bare `pgTable` | Direct SQL / bun-db | Not an implicit projection |

**Default:** if the row is authoritative state that mutates without lifecycle
events, use **`r.unmanagedTable`** with a stable `reason` string (e.g.
`read_side.user_sessions_direct_write`).

**Use `r.entity` + executor** when the table *is* the projection of an event log
and every mutation should be reconstructible.

## Examples

### Event-sourced (`user` feature)

```ts
r.entity("user", userEntity);
const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });
// handlers call crud.create / crud.update — events appended, rebuild-safe
```

### Direct-write store (`sessions` feature)

```ts
// Hot path: sessionCreator + revoke handlers write without lifecycle events.
r.unmanagedTable(buildEntityTableMeta("user-session", userSessionEntity), {
  reason: "read_side.user_sessions_direct_write",
});
```

See `packages/bundled-features/src/sessions/feature.ts` and
`sessions/__tests__/rebuild-survival.integration.test.ts`.

### GDPR forget hook on a direct-write table (`user-data-rights` recipe)

```ts
r.unmanagedTable(buildEntityTableMeta("note", noteEntity), {
  reason: "read_side.notes_direct_write",
});
// forget hook may updateMany/deleteMany without events — rebuild must not replay
```

## CI guard

`infra/guards/guard-direct-entity-writes.ts` (bin: `kumiko-guard-direct-entity-writes`)
**blocks** production direct-writes on tables registered as ES entities or
`r.entity` implicit projections. Allowed paths:

- `createEventStoreExecutor` / projection `apply` callbacks (`tx` receiver inside
  `defineApply` or `r.projection({ apply: … })`)
- Test / testing-helper files (excluded by path)

`r.unmanagedTable` tables are not collected as rebuildable — that is the
intended fix path when the guard fires.

## Related

- Live == rebuild equivalence (executor path): `packages/framework/src/db/__tests__/implicit-projection-equivalence.integration.test.ts`
- Runtime drift detection (not yet shipped): kumiko-framework#722
- Projection-aware migrations (managed vs unmanaged DDL): `docs/archive/plans/projection-aware-migrations.md`

