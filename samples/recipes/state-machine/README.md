# State Machine

Enforced entity state transitions.

## What it shows

- `defineTransitions` + `guardTransition`
- Each transition as its own domain event for a readable audit trail

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/state-machine
bun test
```
