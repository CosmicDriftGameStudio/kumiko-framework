# 05 Close a task through a domain event

Measures: appending an own domain event instead of setting fields directly, a
projection that derives state from it, rebuild safety.

## Task text

Give the agent everything between the two rules verbatim.

---

Extend the scaffolded `tasks` feature of this Kumiko app with a close
operation.

- A write handler `tasks:write:task:close` with the payload
  `{ id: string, version: number }`. It appends a domain event "task closed"
  to the task's event stream.
- The task's `status` becomes `"done"` and a new timestamp field `closedAt` of
  the task is set. Both come from that event through a projection, not from a
  direct field update in the handler.
  - An unknown id is rejected as not found.
  - A stale `version` is rejected as a version conflict.
- Every signed-in user of a tenant may close the tenant's tasks.
- Integration tests for every case above, including that a projection rebuild
  yields the same task state again.

You are done when `bun run typecheck`, `bun run lint`, `bun run test`,
`bun run boot` and `bun run test:integration` pass and the database migration
matches.

---

## Acceptance

`acceptance/05-close-by-event.integration.test.ts.tmpl`:

- After `close`, the task detail shows `status` `done` and `closedAt` set.
- The event stream of the task holds a "closed" event.
- After `rebuildProjection("tasks:projection:task-entity", ...)` the detail is
  unchanged: same status, same `closedAt`.
- 404 for an unknown id, `version_conflict` for a stale version.
- A second tenant cannot see the task.

Review by hand: no `executor.update` or `setFields` in the handler, the event
is registered with its own schema, a migration exists for `closedAt`.
