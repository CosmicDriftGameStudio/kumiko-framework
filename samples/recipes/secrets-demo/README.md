# Secrets Demo

Tenant-owned secrets with envelope encryption, DEK cache, and KEK rotation.

## What it shows

- `r.secret` + `ctx.services.secrets.get` (audited reads)
- Charge-style handler that never returns the plaintext key
- A system-scope secret edited on a `configEdit` screen (`secretKeys`) with a handler button row (`actions`) and `compact: true` (no origin icon, reset link or accent bar)

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/secrets-demo
bun test
```
