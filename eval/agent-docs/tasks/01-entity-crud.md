# 01 Entity with list and form

Measures: entity, standard handlers, declarative screens, nav, translations,
personal-data annotations, migration, integration test.

## Task text

Give the agent everything between the two rules verbatim.

---

Add a contacts feature to this Kumiko app.

- Feature name `contacts`, exported as `contactsFeature` from
  `src/features/contacts/index.ts`, and mounted in the app.
- Entity `contact` with the text fields `name` (required), `email`, `phone`
  and `company`. Name, email and phone are personal data of the contact;
  company is business data.
- The standard create, update, delete, list and detail handlers. Every
  signed-in user of a tenant may use them.
- A list screen with id `contact-list` (columns name, company, email), an edit
  screen with id `contact-edit` for all four fields, and a sidebar nav entry
  with id `contacts` that opens the list.
- Labels for the screens and the nav entry come from translations, not from
  hard-coded text.
- An integration test that creates a contact and lists it for its own tenant
  only.

You are done when `bun run typecheck`, `bun run lint`, `bun run test`,
`bun run boot` and `bun run test:integration` pass and the database migration
matches the new entity.

---

## Acceptance

`acceptance/01-entity-crud.integration.test.ts.tmpl`:

- `contacts` is in `APP_FEATURES`; screens `contact-list`, `contact-edit` and
  nav `contacts` are declared.
- Create, update (with `version`), detail and delete round-trip through
  `contacts:write:contact:*` and `contacts:query:contact:*`.
- Tenant isolation of the list.
- A create without `name` fails with a 4xx error.

Review by hand: the personal-data stance of `name`, `email` and `phone`
(`personal: false` on them is a rule break), and no hand-written JSX.
