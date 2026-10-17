# 02 Handlers with business logic and an integration test

Measures: custom write and query handlers, entity executor, typed domain
failures, optimistic locking, integration test over the real stack.

## Task text

Give the agent everything between the two rules verbatim.

---

Extend the scaffolded `tasks` feature of this Kumiko app with two handlers.

- A write handler `tasks:write:task:complete` with the payload
  `{ id: string, version: number }`. It sets the task's `status` to `"done"`.
  - A task whose status already is `"done"` is rejected with a typed domain
    error whose reason is `task_already_done` (a client error, not a server
    error).
  - An unknown id is rejected as not found.
  - A stale `version` is rejected as a version conflict.
- A query handler `tasks:query:task:open-count` with the payload `{}`. It
  returns `{ count: number }`, the number of the current tenant's tasks whose
  status is not `"done"`, tasks without a status included.
- Both handlers may be used by every signed-in user of a tenant.
- Integration tests for every case above, including that open-count only
  counts the caller's own tenant.

You are done when `bun run typecheck`, `bun run lint`, `bun run test`,
`bun run boot` and `bun run test:integration` pass.

---

## Acceptance

`acceptance/02-custom-handlers.integration.test.ts.tmpl`:

- `complete` sets `status` to `done` and bumps the version to 2.
- `task_already_done` with a 4xx status, 404 for an unknown id,
  `version_conflict` for a stale version.
- `open-count` counts not-done tasks, tasks without status included, per
  tenant.

Review by hand: no raw SQL writes, no `createTestDispatcher`, failures
returned as typed failures rather than thrown plain `Error`s.
