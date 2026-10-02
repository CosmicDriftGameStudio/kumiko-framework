# Currencies Global

Multi-currency money with a global rate table.

## What it shows

- Money field type + global FX rates
- Conversion helpers shared across tenants

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/currencies-global
bun test
```
