# Secrets Demo

Tenant-owned secrets with envelope encryption, DEK cache, and KEK rotation.

## What it shows

- `r.secret` + `ctx.services.secrets.get` (audited reads)
- Charge-style handler that never returns the plaintext key
- A system-scope secret edited on a `configEdit` screen (`secretKeys`) with a handler button row (`actions`)

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/secrets-demo
bun test
```
