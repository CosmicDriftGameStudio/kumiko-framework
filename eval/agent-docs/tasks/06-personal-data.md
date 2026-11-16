# 06 Store personal data

Measures: marking personal data on fields and events so the framework can
encrypt and erase it.

## Task text

Give the agent everything between the two rules verbatim.

---

Add a new feature `contacts` to this Kumiko app. Export it as
`contactsFeature` from `src/features/contacts`.

- An entity `contact` with the fields `name`, `email` and `phone`, with the
  standard CRUD handlers.
- A write handler `contacts:write:contact:note-call` with the payload
  `{ id: string, version: number, callerName: string }`. It appends a domain
  event to the contact's stream that carries the field `callerName`.
- All person-related fields of the entity and the event field `callerName` are
  marked as personal data, so the framework can encrypt and erase them.
- Every signed-in user of a tenant may use the contact handlers.
- An integration test for creating and reading a contact.

You are done when `bun run typecheck`, `bun run lint`, `bun run test`,
`bun run boot` and `bun run test:integration` pass and the database migration
matches.

---

## Acceptance

`acceptance/06-personal-data.integration.test.ts.tmpl`:

- Create and detail over HTTP return `name` and `email`.
- The `name` and `email` fields of the registered entity carry a personal-data
  flag (`pii`, `userOwned` or `recordOwned`).
- The event written by `note-call` declares `callerName` as a personal-data
  field.

Review by hand: the personal-data annotation `personal` is used instead of
`encrypted: true`, the event's `piiFields` name a `subjectField`.
