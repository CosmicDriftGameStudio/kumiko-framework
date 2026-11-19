# Anonymous Access Multitenant

Anonymous access that still resolves a tenant.

## What it shows

- Public write/read paths in a multi-tenant app
- Tenant resolution without a session user

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/anonymous-access-multitenant
bun test
```
