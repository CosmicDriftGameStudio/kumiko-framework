# Files Post Processing

File upload plus post-processing hooks.

## What it shows

- Declarative `variants` on `createImageField` (file-derivatives)
- Imperative `ctx.services.derivatives.variant()` path and the public variant route (`EXT_DERIVATIVE_PUBLIC_PREDICATE`)

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/files-post-processing
bun test
```
