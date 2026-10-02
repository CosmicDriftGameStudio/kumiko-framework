# Reference Data

Seed reference data with `r.referenceData`.

## What it shows

- Declarative reference rows loaded at boot
- Idempotent seeding for lookup tables

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/reference-data
bun test
```
