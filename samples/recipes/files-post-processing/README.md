# Files Post Processing

File upload plus post-processing hooks.

## What it shows

- Declarative `variants` on `createImageField` (file-derivatives)
- Imperative `ctx.derivatives.variant()` path and the public variant route (`EXT_DERIVATIVE_PUBLIC_PREDICATE`)

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/files-post-processing
bun test
```
