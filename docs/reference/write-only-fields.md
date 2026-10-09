---
status: reference
verified: 2026-10-09
evidence: "packages/types/src/fields.ts (TextFieldDef.writeOnly); packages/framework/src/engine/field-access.ts (maskWriteOnlyFields); packages/framework/src/engine/boot-validator/pii-retention.ts; packages/framework/src/pipeline/__tests__/write-only-field.integration.test.ts; packages/framework/src/pipeline/__tests__/undecryptable-encrypted-field.integration.test.ts; packages/bundled-features/src/user-data-rights/__tests__/export-encrypted-fields.integration.test.ts; packages/renderer/src/components/render-field.tsx"
---

# writeOnly fields: secrets that are never returned

`writeOnly: true` on an entity text field marks a secret the user can set and replace but never read back, such as an API key. Use it on top of `find: "secret"` (which implies `sensitive`: ciphertext at rest, stripped from event echoes).

```ts illustration
apiKey: createTextField({ personal: "tenant", find: "secret", writeOnly: true }),
```

## Write semantics

| Payload value | Effect |
|---|---|
| omitted or `""` | unchanged (an untouched masked input submits `""`) |
| `null` | clears the value (rejected on a `required` field) |
| a string | the new value |
| `true` | rejected: it is the read marker, not a value |

## Read semantics

- Clients see `true` when a value is set and `null` when it is empty: list, detail, write responses (`data`, `changes`, `previous`), nested children of a write, batch responses and `_refs` of eager-loaded references.
- Executor reads (`detail` and `list` inside server handlers) and `postSave` / `postQuery` hooks see the plaintext.
- `ctx.query`, `dispatcher.query`, agent tools and `_refs` see `true` / `null`.
- `ctx.db` sees the stored ciphertext.
- The DSGVO user export decrypts encrypted fields but then masks writeOnly fields, so the bundle carries `true` / `null`, never the secret.

An `encrypted` field whose stored value cannot be decrypted (corrupt ciphertext, wrong key) does not fail `list` or `detail`: that field reads `null`, the other fields and rows are served, and the executor logs one error per field with the entity, row id, field and error class (never the ciphertext). Write paths (update, delete, restore) still fail loud on such a row, so a broken value is never overwritten from a read that came back `null`. PII-subject fields keep failing loud.

Known limit: masking runs for entity-bound query handlers whose result is an array, a `{ rows }` object or a flat row. An unbound custom query handler that returns executor rows must call `maskWriteOnlyFields(entity, row)` from `@cosmicdrift/kumiko-framework/engine` itself, the same scope limit as `access.read`.

## Boot-validator restrictions

- Entity text fields only: not on other field types, embedded sub-fields, or screen / form fields.
- Requires `sensitive` (use `find: "secret"`).
- Cannot combine with `default`, `searchable`, `sortable`, `filterable` or `lookupable`: a value that is never returned cannot be defaulted, searched, sorted, filtered or looked up.
- A feature cannot register a second handler under a name `r.crud` already registers (`entity:detail`, `entity:create`, ...): the duplicate would replace the masking handler, so `defineFeature` throws.

## UI

The edit form renders a password input. A stored value shows the placeholder "Set"; typing replaces it. Optional fields get a clear icon inside the input ("Remove stored value") that marks the value for removal on save; an undo icon in the same place reverts it. Nothing is prefilled and the secret never reaches the browser.
