# State Machine

Enforced entity state transitions.

## What it shows

- `defineTransitions` + `guardTransition`
- Each transition as its own domain event for a readable audit trail

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/state-machine
bun test
```
