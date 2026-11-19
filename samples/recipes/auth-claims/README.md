# Auth Claims

Features inject identity facts into the JWT.

## What it shows

- `r.authClaims(fn)` contributing to `SessionUser.claims`
- Claims recomputed on login and tenant switch

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/auth-claims
bun test
```
