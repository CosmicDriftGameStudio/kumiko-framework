# Search

Tenant-scoped full-text search (Meilisearch / in-memory adapter).

## What it shows

- `searchable` / `searchWeight` on fields
- Handler reads via `ctx.services.searchAdapter`
- `createLongTextField({ find: "fuzzy" })`: a long body is searchable (Meilisearch splits it into pieces)
- Trash list: `softDelete` entity, list with `onlyDeleted: true`, restore via `article:restore`

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/search
bun test
```
