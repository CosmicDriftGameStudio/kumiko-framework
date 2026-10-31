# Lane Routing

Pin jobs to deploy lanes (`api` | `worker`) with event-triggered fan-out.

## What it shows

- `r.job({ runIn: "worker" })` after an HTTP write
- `trigger: { maintenance: true }` for a daily housekeeping job in the app's maintenance window (`KUMIKO_MAINTENANCE_WINDOW`)
- `wakesSleepingApp: false` on a cron trigger for upkeep that must not wake a sleeping shared app
- End-to-end verification via `createAllInOneEntrypoint`

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/lane-routing
bun test
```
