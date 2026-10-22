# Tenant Isolation

Multi-tenant data isolation by default.

## What it shows

- Tenant filter on ordinary handlers
- `ctx.db.upsert`: insert-or-update on a tenant-scoped, non-event-sourced table. `conflictTarget` must contain `tenantId` and match a declared unique index (here `tenant_id, key`); event-fed tables are rejected
- What breaks if you forget tenancy (and how the framework prevents it)

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/tenant-isolation
bun test
```
