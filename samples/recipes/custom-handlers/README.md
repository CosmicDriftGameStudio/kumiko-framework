# Custom handlers

Replace the default CRUD with handler bodies that carry business rules.
This recipe ships a `counter` entity with three custom write handlers
(create, increment with read-modify-write, reset with last-writer-wins)
plus a custom query that filters the projection.

The point is to show the **boundary**: where the entity executor stops
doing work for you and where your code has to take over. The framework
gives you `createEntityExecutor` so the executor's `create` / `update` /
`detail` / `list` are still one-liners — only the surrounding business
logic is yours.

## What it shows

- **`r.writeHandler({ name, schema, handler, access })`** — the inline
  form, useful when the handler body is short and stays close to its
  registration.
- **Read-modify-write with optimistic locking** — `increment` reads the
  current count, computes the new one, and updates with the version it
  read. Two concurrent increments cannot both succeed.
- **`createMany` for many rows in one handler** — `create-many` writes all
  events with one append statement and projects the rows in one savepoint;
  one invalid row fails the whole batch, nothing is written.
- **`skipOptimisticLock` for last-writer-wins** — `reset` deliberately
  bypasses the version check because the operation is admin-driven and
  resetting twice is semantically the same as resetting once.
- **Named verbs** — `verbs` on the entity and `update(..., { verb })` write
  `counter.archived` or `counter.reset` instead of `counter.updated`. The
  executor checks the declared transition (`archive` fails with
  `invalid_transition` unless the status is `open`) and sets the field.
- **`history` and `listAsOf`** — `history({ id })` returns the lifecycle and
  verb events of one counter, `listAsOf({ asOf })` folds the events up to an
  instant into rows.
- **Custom queries** — `counter:active` passes a server-side `filter`
  (`eq`/`ne`/`lt`/`gt`/`lte`/`gte`/`in`) and `totalCount` to the executor's
  list. Never filter a page in TypeScript: list is paginated, so rows after
  the first page would be missed.
- **`dispatchOnly` queries**: `counter:last-incremented-by` sets
  `dispatchOnly: true`, so `/api/query` answers it with 404 as if it did
  not exist. `counter:incremented-by-me` calls it with
  `ctx.dispatch.query(ref, payload)` and returns only the derived answer.
  Use it for a building block that other handlers share but no client
  should call directly. It closes the HTTP entry only: its access rule still
  counts as a read grant on the entity for linked lists and derived values.
  The boot check rejects it wherever the browser would load it (screens,
  field options, summary rows).
- **`failNotFound` helper** — typed error response for the 404 case
  without a hand-built `KumikoError` subclass.

## When to reach for it

You have an entity but the default CRUD doesn't capture what your
business rule actually does. The default `update` blindly writes the
payload; your `increment` needs to read first, decide, and write. That's
the line.

## Source

The whole feature lives in `src/feature.ts` (~100 lines). Integration
tests cover the optimistic-lock case, the skip-lock case, and the
custom-filter query.

```bash
bun kumiko test integration samples/custom-handlers
```
