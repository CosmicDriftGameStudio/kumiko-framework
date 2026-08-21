# State Machine

Enforced entity state transitions.

## What it shows

- `defineTransitions` + `guardTransition`
- Each transition as its own domain event for a readable audit trail

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/state-machine
bun test
```
