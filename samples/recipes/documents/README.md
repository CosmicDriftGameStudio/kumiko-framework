# Documents

A document register on top of existing records: captured files with a category, linked to records, visible only to whoever may read those records.

## What it shows

- `createDocumentsFeature` (`@cosmicdrift/kumiko-bundled-features/documents`) with `categories`, `linkTargets` and `access` roles.
- A `capture` rule turns a file field into a document source without the entity knowing about the documents feature: every saved `contract.file` is filed as a document of category `contract`, titled from the row, and linked to the contract's property.
- Visibility follows the linked records: a document is visible to users who may read the linked records and the contract that owns the file. The `documents:query:for-record` query returns the documents of one record; a property reader sees none for the property because they may not read the contract that owns the file.

## Source

Feature entry point: `src/feature.ts`.

```ts file=<rootDir>/_samples/recipes-documents/src/feature.ts
```

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/documents
bun test
```
