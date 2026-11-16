# Reference Data

Seed reference data with `r.referenceData`.

## What it shows

- Declarative reference rows loaded at boot
- Idempotent seeding for lookup tables

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/reference-data
bun test
```
