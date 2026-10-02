# Rate Limiting

End-to-end rate limiting: L1 global-IP + L2 auth + L3 handler opt-in.

## What it shows

- Handler `rateLimit: { per, limit, windowSeconds }`
- How L1/L2 from `buildServer` stack with L3

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/rate-limiting
bun test
```
