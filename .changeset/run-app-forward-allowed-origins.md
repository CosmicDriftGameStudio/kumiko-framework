---
"@cosmicdrift/kumiko-dev-server": minor
---

run-prod-app / run-dev-app: forward `allowedOrigins` + `unsafeSkipOriginCheck` to buildServer

`RunProdAppAuthOptions` / `RunDevAppAuthOptions` exposed `cookieDomain` but not
`allowedOrigins` (or `unsafeSkipOriginCheck`), while the buildServer Origin guard
(#340) **fails closed** when `cookieDomain` is set without an allowlist. An app
that widened its session cookie across subdomains therefore could not satisfy the
guard through `runProdApp`/`runDevApp` — it could only CrashLoop on boot.

Both fields are now part of the auth options and forwarded into the buildServer
auth config alongside `cookieDomain`. Proven by a boot test: `cookieDomain` alone
fails closed through `runProdApp`; `cookieDomain` + `allowedOrigins` clears the
guard (the allowlist reaches buildServer).
