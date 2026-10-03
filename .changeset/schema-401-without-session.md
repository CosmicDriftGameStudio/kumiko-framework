---
"@cosmicdrift/kumiko-framework": patch
---

`GET /api/schema` without a session now answers 401 `missing_token` even when `anonymousAccess` is on and the tenant resolver finds no tenant. Before, the request fell into the anonymous tenant flow and returned 400 `tenant_required`, so a client could not tell a logged-out session from a server error.

<!-- kumiko-changes
feature: framework
type: fix
title: /api/schema answers 401 instead of 400 tenant_required after logout
detail: |
  With `anonymousAccess` and an authoritative tenant resolver, a request without a token to `/api/schema` ran through tenant resolution and failed with 400 `tenant_required`. Paths that need a session but no tenant (`/api/auth/*` and `/api/schema`) are now listed in `isSessionRequiredApiPath` and answer 401 `missing_token` before any tenant lookup.
migration: |
  No code change needed.
-->
