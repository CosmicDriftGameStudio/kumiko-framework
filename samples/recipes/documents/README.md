# Documents

A document register on top of existing records: captured files with a category, linked to records, visible only to whoever may read those records.

## What it shows

- `createDocumentsFeature` (`@cosmicdrift/kumiko-bundled-features/documents`) with `categories`, `linkTargets` and `access` roles.
- A `capture` rule turns a file field into a document source without the entity knowing about the documents feature: every saved `contract.file` is filed as a document of category `contract`, titled from the row, and linked to the contract's property.
- Visibility follows the linked records: a document is visible to users who may read the linked records and the contract that owns the file. The `documents:query:for-record` query returns the documents of one record; a property reader sees none for the property because they may not read the contract that owns the file.
- A reference to a filed document links its file: the `offer` entity references `documents:filed-document`, and since that entity has exactly one file field, the `receipt` cell of the `offer-list` screen shows the document title as a download link with the PDF view in a drawer, like the file column of the documents list. The link comes from the rows of the reference lookup (`documents:query:filed-document:list`), so a user who may not read the document or its file field gets plain text or nothing.
- An `actionForm` success fact of `type: "file"`: the `contract-copy` screen calls `contract:send-copy`, whose result names the contract's FileRef id in `contractFile`. The success box shows that id with file name, download link and preview. The id resolves through `/api/files/meta` only for a user of the contract's tenant who may read the file; another tenant gets nothing.

## Source

Feature entry point: `src/feature.ts`.

```ts file=<rootDir>/_samples/recipes-documents/src/feature.ts
```

## Tests

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/documents
bun test
```
