# Lane Routing

Pin jobs to deploy lanes (`api` | `worker`) with event-triggered fan-out.

## What it shows

- `r.job({ runIn: "worker" })` after an HTTP write
- End-to-end verification via `createAllInOneEntrypoint`

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/lane-routing
bun test
```
