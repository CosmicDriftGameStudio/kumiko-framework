# Currencies Per Tenant

Multi-currency money with per-tenant rate tables.

## What it shows

- Tenant-scoped FX rates
- Same money field API as the global recipe

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/currencies-per-tenant
bun test
```
