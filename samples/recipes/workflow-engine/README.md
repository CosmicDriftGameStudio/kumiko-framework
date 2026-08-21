# Workflow Engine

Tier-3 `defineWorkflow` vocabulary: wait, branch, mail, webhook, retry.

## What it shows

- Real runnable pipelines (no empty `build: () => []` stubs)
- Workflow-run lifecycle across wait / waitForEvent / retry

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/workflow-engine
bun test
```
