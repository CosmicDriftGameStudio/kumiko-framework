# Search

Tenant-scoped full-text search (Meilisearch / in-memory adapter).

## What it shows

- `searchable` / `searchWeight` on fields
- Handler reads via `ctx.searchAdapter`

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/search
bun test
```
