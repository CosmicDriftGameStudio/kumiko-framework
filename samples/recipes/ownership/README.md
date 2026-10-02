# Ownership

Row-level ownership for read and write.

## What it shows

- Entity- and field-level ownership rules
- Straddle-safe checks across tenants/users

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/ownership
bun test
```
