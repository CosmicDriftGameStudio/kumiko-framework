---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

The web SPA calls `GET /api/auth/tenants` on every page load to bootstrap its session, which used to trip the L2 auth-endpoint rate limiter after 5 requests/minute and left the UI stuck on the loading screen. `rateLimit.auth` now exempts this exact route, and the client now surfaces bootstrap failures instead of hanging.

<!-- kumiko-changes
feature: framework
type: breaking
title: rateLimit.auth (L2) no longer throttles GET /api/auth/tenants
detail: |
  The SPA's own session bootstrap called GET /api/auth/tenants on every
  page load, which counted against the L2 auth-endpoint bucket and threw
  429 on the 6th page load within a minute. This route is now exempted
  from rateLimit.auth by exact method+path match; all other auth routes
  (including POST on the same path, if ever added) are unaffected.
migration: |
  Apps using the default rateLimit.auth need no changes. Apps that want
  to keep throttling GET /api/auth/tenants should rely on rateLimit.global
  (L1, IP-based) instead. Credential-submitting POST routes are unaffected
  even when rateLimit.auth's `path` option is customized.
-->

<!-- kumiko-changes
feature: auth-email-password
type: breaking
title: Session bootstrap failures now render a retryable error screen instead of hanging on "loading"
detail: |
  fetchTenants()/fetchCurrentUser() failures (rate limit, 5xx, network)
  used to reject out of the session bootstrap effect and leave the UI on
  the loading placeholder forever. SessionStatus gained an "error" value
  and SessionState gained a bootstrapFailure field; the auth gate now
  renders SessionBootstrapErrorScreen with a Retry-After-aware retry
  button for this case.
migration: |
  Code with an exhaustive switch over SessionStatus, or tests/stories that
  hand-build a SessionState literal, needs to add the "error" case and the
  bootstrapFailure field. refresh() no longer rejects on bootstrap
  failures; it resolves and sets status to "error" instead.
-->
