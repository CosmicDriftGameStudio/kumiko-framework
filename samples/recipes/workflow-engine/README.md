# Workflow Engine

Tier-3 `defineWorkflow` vocabulary: wait, branch, mail, webhook, retry.

## What it shows

- Real runnable pipelines (no empty `build: () => []` stubs)
- Workflow-run lifecycle across wait / waitForEvent / retry

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/workflow-engine
bun test
```
