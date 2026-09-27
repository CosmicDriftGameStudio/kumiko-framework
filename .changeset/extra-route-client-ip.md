---
"@cosmicdrift/kumiko-framework": minor
---

An anonymous extra route had no way to read the server's resolved client IP without reaching for `X-Forwarded-For` itself — exactly the attacker-controlled, hop-count-unaware read the centralized `createClientIpResolver` (kumiko-framework#3323) exists to prevent.

<!-- kumiko-changes
feature: framework
type: improvement
title: AnonymousExtraRouteDeps gained clientIp, resolved by the server's trustedProxyHops-aware resolver
detail: |
  `AnonymousExtraRouteDeps.clientIp: string`, populated the same way as the
  httpRoute path via `shared.clientIpResolver.resolve
  (clientIpSourceFromHonoContext(c))`. `ExtraRouteHonoHandlerDeps
  .clientIpResolver` is now required (its only caller always supplied it).
migration: |
  Anonymous extra routes that need the caller's IP should read
  `deps.clientIp` instead of reading `X-Forwarded-For` (or any other
  header) themselves — the latter is attacker-controlled unless you also
  know the exact trusted-hop count. Tests that build an
  `AnonymousExtraRouteDeps` literal by hand must add a `clientIp` string.
-->
