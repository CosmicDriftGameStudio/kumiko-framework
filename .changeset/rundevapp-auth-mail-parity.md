---
"@cosmicdrift/kumiko-dev-server": minor
---

runDevApp parity with runProdApp's app-shell hoist

`runDevApp` now supports the same `auth.mail` convenience block and auto-wires `textContent` (always) + `secrets` (feature-gated) into the dev AppContext, plus a `masterKey?` override — so an app's `bin/server.ts` drops the same SMTP block, auth-mailer wrapper, and provider wiring as its `bin/main.ts`. `resolveAuthMail` is now generic over the prod/dev auth-option types, and the shared `AuthMailOptions` type is exported. Additive and backward-compatible.
