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

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/lane-routing
bun test
```
