# Ownership

Row-level ownership for read and write.

## What it shows

- Entity- and field-level ownership rules
- Straddle-safe checks across tenants/users

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/ownership
bun test
```
