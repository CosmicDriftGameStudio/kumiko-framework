---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
---

Centralized, trustedProxyHops-aware client-IP resolver for every IP-based rate limit (kumiko-framework#3323)

`rate-limit/middleware.ts`'s L1/L2 rate limits, `auth-routes.ts`'s auth rate limits and `requestIdMiddleware`'s `requestContext.ip` each derived the caller's IP their own way, all trusting the first `X-Forwarded-For` entry unconditionally — a header any client can set, so any of them was bypassable by an attacker who simply forged a first entry, and an app with no reverse proxy in front of it had no defense at all. Worse, `requestIdMiddleware` left `ip` `undefined` when no XFF header was present, which made `dispatch-shared.ts`'s `enforceRateLimit` treat the whole bucket as skippable — an L3 handler with `rateLimit: { per: "ip" }` silently never throttled a client that omitted the header.

All three now share one `createClientIpResolver` (`@cosmicdrift/kumiko-framework/api`). A new top-level `trustedProxyHops` option on `buildServer`, `runProdApp` and `runDevApp` (default `0`) replaces the old first-entry heuristic: `0` trusts no proxy header at all (only the real socket address, sourced once from Bun's `server.requestIP()`, counts), `n >= 1` reads the n-th `X-Forwarded-For` entry from the right (falling back to `X-Real-IP`, then the socket address, for a chain shorter than `n`). A bucket is never skipped anymore — with no usable value the resolver falls back to a fixed `"unknown"` string, which shares one bucket across affected clients rather than letting them bypass the limit entirely. The deprecated `auth.trustedProxyHops` still works as a fallback when the new top-level option isn't set.

<!-- kumiko-changes
feature: framework
type: breaking
title: Centralized client-IP resolver replaces the old first-XFF-entry heuristic
detail: |
  New `trustedProxyHops` option on `ServerOptions` (default 0 — trusts no
  proxy header, only the socket address counts). Precedence:
  `options.trustedProxyHops ?? options.auth?.trustedProxyHops ?? 0`.
  `requestContext.ip` is now always set for an HTTP request (falls back to
  "unknown" instead of being left undefined), so `rateLimit: { per: "ip" }`
  handlers reached via `r.httpRoute`/`extraRoutes` systemQuery are never
  silently unthrottled. `rate-limit/middleware.ts`'s `globalIpRateLimit`/
  `authEndpointRateLimit` and `auth-routes.ts`'s `createAuthRoutes` gained a
  `trustedProxyHops`/`clientIpResolver` option and now share the server's
  one resolver instance instead of each building their own.
migration: |
  Apps deployed behind a reverse-proxy/ingress that appends to
  X-Forwarded-For must set `trustedProxyHops` (buildServer/runProdApp/
  runDevApp top-level option) to the number of trusted hops — usually `1`
  for a single ingress. Without it, every client collapses into one shared
  rate-limit bucket (safe default, but likely too strict for real traffic).
  Apps not behind a proxy need no change; `trustedProxyHops` defaults to 0.
-->

<!-- kumiko-changes
feature: server-runtime
type: breaking
title: runProdApp threads the Bun socket address and a trustedProxyHops option through to the client-IP resolver
detail: |
  `buildBunServeOptions` now extracts the client socket address once via
  `server.requestIP(req)` at the outermost Bun.serve fetch callback (a
  cloned/rebuilt Request loses that ability) and threads it through
  `tryHonoFirst`/`withSecurityHeaders`/`buildStaticFallback` as Hono's
  `env`. `RunProdAppOptions` gained a top-level `trustedProxyHops` (falls
  back to the deprecated `auth.trustedProxyHops`, then
  `KUMIKO_TRUSTED_PROXY_HOPS`), forwarded into `buildServer` and the
  static-fallback's own client-IP resolver.
migration: |
  Same as the framework entry — set `trustedProxyHops` on `runProdApp` when
  deployed behind a reverse-proxy/ingress.
-->

<!-- kumiko-changes
feature: dev-server
type: breaking
title: createKumikoServer/runDevApp gained a trustedProxyHops option
detail: |
  `CreateKumikoServerOptions`/`RunDevAppOptions` gained a top-level
  `trustedProxyHops`, forwarded into `setupTestStack`'s `buildServer` call.
  Dev normally runs unproxied, so this is usually left unset (default 0).
migration: |
  No action needed for the default (unproxied) dev setup. Set
  `trustedProxyHops` only if you run the dev server behind a reverse proxy.
-->
