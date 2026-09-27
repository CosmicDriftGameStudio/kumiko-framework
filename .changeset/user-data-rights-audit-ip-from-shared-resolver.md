---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

user-data-rights takes the audit IP from the shared client-IP resolver

`extractAuditMeta` read the first `X-Forwarded-For` entry itself — a header any client can set — so a caller could plant a fake IP for their own download attempt in the audit trail (`recordDownloadUse`/`recordInvalidAttempt`). `r.httpRoute` handlers had no access to the server's `trustedProxyHops`-aware resolver at all: `requestIdMiddleware` only wraps `/api/*`, and `user-export/by-token` is an anonymous `r.httpRoute`. `HttpRouteHandlerDeps` gained a `clientIp: string` field, computed once per request in `buildServer`'s httpRoute mount loop from the same shared resolver instance `/api/*` and the L1/L2 rate limits already use. `extractAuditMeta` now takes that resolved value as a parameter instead of parsing headers itself.

<!-- kumiko-changes
feature: framework
type: fix
title: HttpRouteHandlerDeps carries the resolved clientIp
detail: |
  `r.httpRoute` handlers get a new `clientIp: string` dep, resolved once per
  request via `buildServer`'s existing shared `clientIpResolver` (the same
  instance `requestIdMiddleware` and the L1/L2 rate limits use), instead of
  each handler parsing `X-Forwarded-For`/`X-Real-IP` itself with no
  knowledge of the deployment's actual `trustedProxyHops`. `UNKNOWN_CLIENT_IP`
  is now exported from `@cosmicdrift/kumiko-framework/api` so callers can
  detect the resolver's no-value sentinel without hardcoding the string.
-->

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: Audit IP comes from the framework's trustedProxyHops-aware resolver, not a self-parsed X-Forwarded-For
detail: |
  `extractAuditMeta` no longer reads `X-Forwarded-For`/`X-Real-IP` itself —
  it takes the `clientIp` the `/user-export/by-token` httpRoute handler now
  receives from `HttpRouteHandlerDeps`, mapping the resolver's `unknown`
  sentinel to `null`. Closes the spoofed-first-XFF-entry gap for that
  route. A caller invoking `/api/query`'s `download-by-token` handler
  directly (not through this httpRoute) can still pass its own `auditMeta`
  in the payload — a pre-existing, documented tradeoff (the handler's own
  comment: audit data isn't security-relevant), unchanged by this fix.
-->
