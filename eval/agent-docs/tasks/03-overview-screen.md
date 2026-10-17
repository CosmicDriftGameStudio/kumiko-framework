# 03 Screen built from existing widgets

Measures: finding a fitting screen type or widget instead of hand-written JSX,
a query handler behind it, nav, translations, UI guards.

## Task text

Give the agent everything between the two rules verbatim.

---

Add a task overview page to this Kumiko app, inside the scaffolded `tasks`
feature.

- A query handler `tasks:query:task:stats` with the payload `{}` that returns
  `{ total: number, urgent: number, done: number }` for the current tenant:
  all tasks, tasks with `isUrgent` set, and tasks whose status is `"done"`.
  Every signed-in user of a tenant may use it.
- A screen with id `task-overview` that shows these three numbers as KPI tiles,
  and a sidebar nav entry with id `task-overview` that opens it.
- Build the page from what the framework already provides. All visible text
  comes from translations.
- An integration test for the stats handler, including that it only counts
  the caller's own tenant.

You are done when `bun run typecheck`, `bun run lint`, `bun run test`,
`bun run boot` and `bun run test:integration` pass.

---

## Acceptance

`acceptance/03-overview-screen.integration.test.ts.tmpl`:

- Screen `task-overview` and nav `task-overview` are declared.
- `stats` returns the exact counts per tenant, and zeros for an empty tenant.

Review by hand: the screen uses a declarative screen type (for example
`dashboard`) or, in a custom screen, only widgets from
`@cosmicdrift/kumiko-renderer-web` and `usePrimitives()`; data comes through
`useQuery`, not `useEffect` plus `fetch`; no inline styles or palette
classes. The UI guards in `check-project.sh` cover part of this.
