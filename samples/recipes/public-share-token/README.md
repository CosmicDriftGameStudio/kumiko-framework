# Public share token

Minimal pattern for **tokenized anonymous read surfaces**: authenticated users
mint a link; visitors resolve it without login.

Domain-agnostic — no credit/folder logic. Full consumer:
[Cashcolt money-horse](https://github.com/CosmicDriftGameStudio/money-horse)
(`share-by-token` + 5 layout templates).

## What it shows

- **`createEntity` + event-sourced CRUD** — `tokenHash` unique, plain token show-once
- **`defineWriteHandler` / `defineQueryHandler`** — create, revoke, read-by-token
- **Anonymous query** — `roles: ["anonymous", …]` + `rateLimit: { per: "ip+handler" }`
- **404 ohne Leak** — invalid / expired / revoked → same `NotFoundError` shape
- **`anonymousAccess`** on test stack (see integration test)

Client wiring: [`recipes/apex-surface-auth`](../apex-surface-auth/) or a gate
before `createKumikoApp` (money-horse uses `public-share-gate.tsx` like the public
calculator).

## Handlers

| QN | Access |
|---|---|
| `public-share:write:share-link:create` | authenticated (`openToAll`) |
| `public-share:write:share-link:revoke` | owner |
| `public-share:query:share-by-token` | anonymous + authenticated |

## Run tests

From repo root (needs `TEST_DATABASE_URL` + `REDIS_URL`):

```bash
cd kumiko-framework/samples/recipes/public-share-token
bun test src/__tests__/feature.integration.test.ts
```
