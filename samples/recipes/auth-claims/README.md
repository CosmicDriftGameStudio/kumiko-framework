# Auth Claims

Features inject identity facts into the JWT.

## What it shows

- `r.authClaims(fn)` contributing to `SessionUser.claims`
- Claims recomputed on login and tenant switch

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/auth-claims
bun test
```
