# Access Control

Default-deny access rules and FK indices via relations.

## What it shows

- Handler `access` roles as the default-deny gate
- Relation-declared FK indices for join-friendly schemas

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/access-control
bun test
```
