---
"@cosmicdrift/kumiko-dev-server": patch
---

`runProdApp` now wires sessions **secure-by-default**: mounting `createSessionsFeature()`
turns on server-side session revocation + `sessionStrictMode` automatically, instead of
*also* requiring an explicit `auth.sessions`. Apps that mounted the sessions feature but
never set `auth.sessions` — so their logout / password-reset never actually revoked any
JWT — are now correct without a code change. `auth.sessions` still overrides the config,
and the new `auth.sessions: false` is the explicit opt-out (back to stateless JWTs).
