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

- **`r.writeHandler(name, schema, handler, options)`** — the positional
  inline form, useful when the handler body is short and stays close to
  its registration.
- **Read-modify-write with optimistic locking** — `increment` reads the
  current count, computes the new one, and updates with the version it
  read. Two concurrent increments cannot both succeed.
- **`skipOptimisticLock` for last-writer-wins** — `reset` deliberately
  bypasses the version check because the operation is admin-driven and
  resetting twice is semantically the same as resetting once.
- **Custom queries** — `counter:active` filters the projection in
  TypeScript after the executor's list returns. Useful when the filter is
  computed (above-threshold) rather than indexed.
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
