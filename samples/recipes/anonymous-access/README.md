# Anonymous Access

Public endpoints without a logged-in user.

## What it shows

- `access: "anonymous"` on handlers that must stay public
- Rate limits that still bind anonymous callers (`per: "ip+handler"`)

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/anonymous-access
bun test
```
