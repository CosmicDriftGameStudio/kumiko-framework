# Realtime SSE

Server-sent events — live updates without F5.

## What it shows

- Entity writes that fan out over SSE
- Client subscription shape for live lists
- Presence: `createPresenceFeature({ entities: ["message"] })` answers who else has a message open; the heartbeat is a write, the others get an SSE frame addressed to their user id (no names inside)

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/realtime-sse
bun test
```
