# Idempotency

Same request, same result — dedupe on request ID.

## What it shows

- `requestId` prevents duplicate inserts and returns the cached result
- Custom write handler that owns business defaults

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/idempotency
bun test
```
