# Search

Tenant-scoped full-text search (Meilisearch / in-memory adapter).

## What it shows

- `searchable` / `searchWeight` on fields
- Handler reads via `ctx.services.searchAdapter`
- `createLongTextField({ personal: "tenant", find: "fuzzy" })`: a long body is searchable, decrypted for the index (Meilisearch splits it into pieces)
- Trash list: `softDelete` entity, list with `onlyDeleted: true`, restore via `article:restore`
- `r.relation(article, "comments", { type: "hasMany", ..., searchable: true })`: a list search on the article also finds it through a matching comment, only for viewers the comment's detail handler admits, gated like a direct read of the comment

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/search
bun test
```
