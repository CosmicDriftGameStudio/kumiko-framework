---
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

A `masterKey` provider on runProdApp and runWorkerApp is enough for the boot checks

The boot probe for `encrypted: true` entity fields now accepts the cipher the runner builds from `masterKey` (new `ValidateBootOptions.entityFieldCipher`), and the env-schema parse no longer requires `KUMIKO_SECRETS_MASTER_KEY_V1` when `masterKey` is set. The framework exports `withOptionalEnvKeys` for that, and the secrets feature exports `SECRETS_MASTER_KEK_ENV_KEYS`. Without `masterKey`, a missing env KEK still stops the boot; the message now names both ways to provide a key. A malformed env KEK now fails during boot validation, so `KUMIKO_DRY_RUN_ENV=boot` reports it too.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: masterKey on runProdApp and runWorkerApp replaces the env KEK for the boot checks
migration: |
  Apps that pass `masterKey` can drop `KUMIKO_SECRETS_MASTER_KEY_V1` from their env and deployment config. Apps without `masterKey` change nothing.
-->
