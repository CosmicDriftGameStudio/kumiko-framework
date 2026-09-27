---
"@cosmicdrift/kumiko-framework": minor
---

Personal Access Tokens are now rejected fail-closed on every `/api/*` route except the dispatcher routes (write/batch/query/command/stream) — previously a PAT authenticated on SSE, file upload/download, `/api/auth/*`, feature `r.httpRoute`s and `entry:"user"` extraRoutes the same as a cookie/JWT session, regardless of its granted scopes, since only the five dispatcher routes ever checked the token's scope.

<!-- kumiko-changes
feature: framework
type: breaking
title: Personal Access Tokens are now scoped to the dispatcher routes only
migration: |
  A caller using a PAT for SSE, file upload/download, /api/auth/*, a feature
  r.httpRoute, or an entry:"user" extraRoute now gets a 403 and needs a
  session-cookie or JWT credential for those calls instead. The dispatcher
  routes (/api/write, /api/batch, /api/query, /api/command, /api/stream) are
  unaffected.
-->
