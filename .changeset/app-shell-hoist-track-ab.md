---
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

App-shell hoist (boot-wiring + presets): less per-app bootstrap duplication

`runProdApp` now provides framework defaults that apps override only for the exception:

- Auto-wires `textContent` (always) and `secrets` (when the `secrets` feature is mounted) into the AppContext — apps drop their hand-rolled extraContext factory. New optional `masterKey?` override for KMS backends instead of the env KEK provider.
- New `auth.mail` block builds all four auth-mail flows (password-reset, email-verification, signup, invite) from an env-derived SMTP transport + standard templates, replacing the per-app SMTP block + `createAuthMailerConfig` wrapper + `AUTH_PATHS` plucking. Null-transport guard preserved (no `SMTP_HOST` → flows stay unwired); explicit per-flow setups still win.

New helpers:

- `createSmtpTransportFromEnv(env, { fallbackFrom })` (channel-email).
- `seedLegalContentFromJson(db, blocks)` (text-content) — centralises the legal-block seed loop with the load-bearing `ifExists: "update"`.
- `dsgvoSelfServiceFeatures(opts?)` (new `presets` entry) — the five-feature DSGVO + account-self-service chain in dependency order.
- `DEFAULT_AUTH_PATHS` + `makeAuthPaths()`; `createAuthMailerConfig`'s `paths` argument is now optional (defaults to `DEFAULT_AUTH_PATHS`).
- `SECRETS_FEATURE_NAME` constant.

Additive and backward-compatible — existing apps that pass explicit wiring keep working unchanged.
