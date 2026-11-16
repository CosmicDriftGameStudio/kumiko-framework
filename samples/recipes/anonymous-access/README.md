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

Needs the Postgres from the repo root's `docker-compose.yml` (`docker compose up -d`); `TEST_DATABASE_URL` defaults to `postgresql://kumiko:kumiko@localhost:15432/kumiko_test`.

```bash
cd samples/recipes/anonymous-access
bun test
```
