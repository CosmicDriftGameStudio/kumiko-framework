# Feature Toggles

Runtime global feature toggles without reboot.

## What it shows

- Dispatcher gate → `feature_disabled` when a feature is off
- Cross-feature hooks skipped when a dependency toggle is off

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/feature-toggles
bun test
```
