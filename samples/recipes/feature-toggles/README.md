# Feature Toggles

Runtime global feature toggles without reboot.

## What it shows

- Dispatcher gate → `feature_disabled` when a feature is off
- Cross-feature hooks skipped when a dependency toggle is off

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/feature-toggles
bun test
```
