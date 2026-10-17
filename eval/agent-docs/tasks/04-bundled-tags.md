# 04 Mount a bundled feature

Measures: finding a bundled feature in `agents/features.md` instead of
building one, mounting it server and client side, wiring its UI into an
existing screen, migration.

## Task text

Give the agent everything between the two rules verbatim.

---

Users of this Kumiko app want to tag their tasks with free labels such as
"urgent" or "customer-x".

- On the task edit screen (`task-edit` in the scaffolded `tasks` feature) a
  user sees the task's tags and can attach and detach tags, including tags
  that do not exist yet.
- Use what the framework already provides before building anything yourself.
- Tags belong to the tenant: one tenant never sees another tenant's tags.
- An integration test that tags a task and reads the tag back.

You are done when `bun run typecheck`, `bun run lint`, `bun run test`,
`bun run boot` and `bun run test:integration` pass and the database migration
matches the mounted features.

---

## Acceptance

`acceptance/04-bundled-tags.integration.test.ts.tmpl`:

- A feature named `tags` is in `APP_FEATURES`.
- The `task-edit` screen carries an `extension` section.
- With the mounted tags feature, a task is tagged, read back by `entityId`,
  isolated per tenant, and untagged.

Review by hand: the bundled `tags` feature is used (no own tag entity), its
client part is registered in `src/client.tsx`, and a migration for the tag
tables exists.
