# Idempotency

Same request, same result — dedupe on request ID.

## What it shows

- `requestId` prevents duplicate inserts and returns the cached result
- Custom write handler that owns business defaults

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/idempotency
bun test
```
