# Realtime SSE

Server-sent events — live updates without F5.

## What it shows

- Entity writes that fan out over SSE
- Client subscription shape for live lists
- Presence: `createPresenceFeature({ entities: ["message"] })` answers who else has a message open; the heartbeat is a write, the others get an SSE frame addressed to their user id (no names inside)

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/realtime-sse
bun test
```
