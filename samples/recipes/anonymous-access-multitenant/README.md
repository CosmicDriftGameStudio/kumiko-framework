# Anonymous Access Multitenant

Anonymous access that still resolves a tenant.

## What it shows

- Public write/read paths in a multi-tenant app
- Tenant resolution without a session user

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/anonymous-access-multitenant
bun test
```
