---
"@cosmicdrift/kumiko-bundled-features": minor
---

`ctx.secrets.set` now runs the same `valueSchema` check as `secrets:write:set` and throws the same validation error (`secrets.errors.invalidValue`, never carrying the value) before anything is encrypted or stored. `createSecretsContext` takes a required `registry` option that supplies the declared schemas; `runProdApp`, `runDevApp` and `setupTestStack` setups pass the booted registry.

`createChannelTelegramFeature` takes `allowedHosts` (default `["api.telegram.org"]`) and `requireHttps` (default `true`), like the other chat channels. Boot fails when the host of `apiBaseUrl` is not in `allowedHosts` or the URL is not https while `requireHttps` is on. Before, the host of `apiBaseUrl` was its own allowlist and https was only required when the URL already started with `https:`.

<!-- kumiko-changes
feature: channel-telegram
type: breaking
title: Telegram apiBaseUrl must match allowedHosts and use https
migration: |
  An app that sets a custom apiBaseUrl (self-hosted Bot API server, local test server) must also pass allowedHosts: ["<host>"], plus requireHttps: false for plain http. Without it the app fails at boot.
-->

<!-- kumiko-changes
feature: secrets
type: breaking
title: ctx.secrets.set validates against the declared valueSchema
migration: |
  Code that calls createSecretsContext({ db, masterKeyProvider }) must also pass registry (the booted Registry). Programmatic ctx.secrets.set calls with a value that fails the key's valueSchema now throw a ValidationError instead of storing it.
-->
