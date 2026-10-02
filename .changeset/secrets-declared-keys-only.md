---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

`secrets:write:set` and `secrets:write:delete` now accept only keys declared via `r.secret`, and `r.secret` takes an optional `writeRoles` list. Before, any tenant admin could store a secret under an arbitrary key name.

<!-- kumiko-changes
feature: secrets
type: breaking
title: secrets:set and secrets:delete accept only keys declared via r.secret; r.secret takes writeRoles
detail: |
  Both handlers reject a key that no feature declared with `r.secret` (404, i18n key `secrets.errors.unknownKey`). `r.secret` takes `writeRoles`: when set, only users holding one of those roles may set or delete that key (403, i18n key `secrets.errors.writeDenied`). The roles narrow the handler access, so both checks must pass. An empty `writeRoles` array throws at declaration.
migration: |
  Declare every key you set through `secrets:write:set` via `r.secret`. Rows stored under undeclared keys stay in the table but can no longer be set or deleted through the API. A key that only SystemAdmin may write declares `writeRoles: ["SystemAdmin"]`, and the secrets feature must then grant SystemAdmin handler access via `createSecretsFeature({ roles: ["TenantAdmin", "SystemAdmin"] })`. Tests that set a key no feature declares need the same fix: the kumiko-studio test `bundled-stack.integration.test.ts` sets `ai-foundation:secret:anthropic-api-key`, which no feature declares; kumiko-ai-foundation 0.39.1 and 0.40.1 declare the Anthropic key as `ai-provider-anthropic:secret:anthropic-api-key`.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: r.secretNamespace declares a family of runtime-named secret keys
detail: |
  `r.secretNamespace(name, { label, scope: "tenant", writeRoles?, nameSchema? })` declares the prefix `<feature>:<name>.` (kebab-cased) and returns `{ prefix, keyFor(name) }`. `secrets:write:set` and `secrets:write:delete` accept a key under that prefix when the suffix is non-empty and passes `nameSchema`; `writeRoles` applies to every key in the namespace. Namespaces are kept out of `getAllSecretKeys` and the generated secrets screen. `Registry.findSecretNamespace(key)` resolves the namespace of a key. step-dispatcher declares `webhook-auth`, so webhook auth secrets (`step-dispatcher:webhook-auth.<name>`) stay settable through the API.
migration: |
  No code change needed. A feature that stores secrets under a runtime-chosen suffix declares a namespace instead of one `r.secret` per key.
-->
