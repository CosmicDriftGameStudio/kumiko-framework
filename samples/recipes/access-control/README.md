# Access Control

Default-deny access rules and FK indices via relations.

## What it shows

- Handler `access` roles as the default-deny gate
- Relation-declared FK indices for join-friendly schemas

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/access-control
bun test
```
