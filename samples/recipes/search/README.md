# Search

Tenant-scoped full-text search (Meilisearch / in-memory adapter).

## What it shows

- `searchable` / `searchWeight` on fields
- Handler reads via `ctx.searchAdapter`

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/search
bun test
```
