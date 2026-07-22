---
"@cosmicdrift/kumiko-dev-server": patch
---

`composeIdentityStack` and `composeGdprStack` now mount `authFoundationFeature` alongside `sessions` — the registry hard-requires it (`sessions.requires("auth-foundation")`), so any consumer mounting sessions via either helper without it now fails at boot. `composeIdentityStack` also gained an optional `providers` array for the tokenVerifier provider(s) auth-foundation itself requires at least one of (e.g. `createPersonalAccessTokensFeature({ scopes })`) — scopes stay app-owned, not a framework default.

Apps that already mount `authFoundationFeature` explicitly alongside these helpers (money-horse, publicstatus) will get a duplicate-feature boot error on the next bump — drop the explicit mount, the helper now owns it.
