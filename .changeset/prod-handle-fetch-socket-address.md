---
"@cosmicdrift/kumiko-server-runtime": minor
---

`ProdAppHandle.fetch`'s type signature didn't declare the optional socket-address parameter its implementation already accepted, so an app with `autoListen: false` calling `Bun.serve` itself had no typed way to thread `server.requestIP(req)?.address` through to the client-IP resolver.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: ProdAppHandle.fetch's type now declares its optional socket-address parameter
detail: |
  `fetch: (req: Request, socketAddress?: string) => Promise<Response> |
  Response`. The doc comment now explains that an app with `autoListen:
  false` running its own `Bun.serve` must pass
  `server.requestIP(req)?.address`, extracted at the outermost Bun fetch
  callback — `requestIP()` only resolves for Bun's original Request
  instance, not a cloned/rebuilt one. `RunProdAppAuthOptions
  .trustedProxyHops`'s doc comment also dropped the stale "pre-#1539
  spoofable default" wording; 0 hops is the safe socket-only default.
migration: |
  No action needed for the default `autoListen: true` boot. Apps with
  `autoListen: false` can now type-check passing the socket address to
  `handle.fetch`; passing nothing keeps the previous (unresolved) behavior.
-->
