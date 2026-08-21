# Lane Routing

Pin jobs to deploy lanes (`api` | `worker`) with event-triggered fan-out.

## What it shows

- `r.job({ runIn: "worker" })` after an HTTP write
- End-to-end verification via `createAllInOneEntrypoint`

## Source

Feature entry point: `src/feature.ts`.

## Tests

```bash
cd samples/recipes/lane-routing
bun test
```
