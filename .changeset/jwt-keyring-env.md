---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

`loadJwtSecretOrKeyring` (`@cosmicdrift/kumiko-framework/api`) — env-loader for `createJwtHelper`'s keyring param, analog to `secrets`' `loadKeyring`: reads `JWT_SECRET_V<n>` + `JWT_SECRET_CURRENT_VERSION` for zero-downtime rotation, falling back to plain `JWT_SECRET` when no versioned key is set. `runProdApp` now wires it through `entrypoint`/`ServerOptions.jwtSecret` (widened to `string | JwtKeyring`) instead of the plain `JWT_SECRET` string. Without `kid`-tagged rotation (#1291), every key rotation invalidated all sessions at once (#1265, #1292).
