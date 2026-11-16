# Currencies Global

Multi-currency money with a global rate table.

## What it shows

- Money field type + global FX rates
- Conversion helpers shared across tenants

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/currencies-global
bun test
```
