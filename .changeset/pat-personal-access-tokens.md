---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-dev-server": minor
---

Personal Access Tokens: long-lived, revocable bearer credentials for headless HTTP-API access.

- New `personal-access-tokens` bundled-feature: `read_api_tokens` direct-write store, SHA-256 token hashing, show-once mint, `create`/`revoke`/`mine`/`available-scopes` handlers, and a mountable `PatTokensScreen` web UI (`personalAccessTokensClient()`).
- Framework auth seam: bearer tokens prefixed `kpat_` resolve via a new `patResolver` (before jwt.verify) into a `SessionUser`; roles are resolved live per request (not snapshotted). Config-driven scopes (app declares named QN-glob bundles) are enforced fail-closed at the API boundary. Optional per-token rate limiting.
- `runProdApp`/`runDevApp` auto-wire the resolver + rate limiter when the feature is mounted. All new `AuthRoutesConfig`/`SessionUser` fields are optional — no change for apps that don't mount it.
