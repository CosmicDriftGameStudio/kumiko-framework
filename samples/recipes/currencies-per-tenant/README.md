# Currencies Per Tenant

Multi-currency money with per-tenant rate tables.

## What it shows

- Tenant-scoped FX rates
- Same money field API as the global recipe

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/currencies-per-tenant
bun test
```
