# Ownership

Row-level ownership for read and write.

## What it shows

- Entity- and field-level ownership rules
- Straddle-safe checks across tenants/users

`fromParent(field, entity)` lets a child entity inherit ownership instead of copying the scoping column: the `contractNote` entity grants a `TeamMember` exactly the notes whose `contractId` points at a contract that role may read (list, detail) or write (create, update, delete) under the contract's own access map.

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/ownership
bun test
```
