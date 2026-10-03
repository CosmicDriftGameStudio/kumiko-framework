---
"@cosmicdrift/kumiko-framework": patch
---

The server registers a root `app.onError`. A route that rethrows while the client has already hung up (for example `GET /api/auth/tenants` under an aborted request) now answers a body-less `499` with the usual `request aborted by client` warning instead of a bare `DOMException` on `console.error` and an unclassified `500`. Any other uncaught throw gets the standard error envelope and the `[api] handler failed` log line with its cause; an `HTTPException` keeps its own response.

<!-- kumiko-changes
feature: framework
type: fix
title: Uncaught route errors and client aborts go through one error handler
detail: |
  `buildServer` calls `app.onError(handleUncaughtRouteError)`, which reuses the `/api/query` helpers: a rethrown abort of the request signal maps to 499, everything else is classified with `toKumikoError`, logged with `logServerFault` and serialized with `serializeError`. Sub-apps mounted via `app.route()` inherit it.
migration: |
  keine
-->
