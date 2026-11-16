# Relations

Parent-child relations with cascade / restrict.

## What it shows

- Relation declarations between entities
- Delete behaviour (cascade vs restrict)

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/relations
bun test
```
