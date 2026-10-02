# Relations

Parent-child relations with cascade / restrict.

## What it shows

- Relation declarations between entities
- Delete behaviour (cascade vs restrict)

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/relations
bun test
```
