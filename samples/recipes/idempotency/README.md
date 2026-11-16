# Idempotency

Same request, same result — dedupe on request ID.

## What it shows

- `requestId` prevents duplicate inserts and returns the cached result
- Custom write handler that owns business defaults

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/idempotency
bun test
```
