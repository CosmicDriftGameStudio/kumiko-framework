# Anonymous Access

Public endpoints without a logged-in user.

## What it shows

- `access: "anonymous"` on handlers that must stay public
- Rate limits that still bind anonymous callers (`per: "ip+handler"`)
- `anySignedIn: true` next to `anonymous`, so a visitor who is signed in with a role the
  handler does not list is not turned away from a public form

## Source

Feature entry point: `src/feature.ts`.

## Tests

Needs a running Postgres and `TEST_DATABASE_URL` set (e.g. `postgres://postgres:postgres@127.0.0.1:5432/postgres`, see `demo/.env.example`).

```bash
cd samples/recipes/anonymous-access
bun test
```
