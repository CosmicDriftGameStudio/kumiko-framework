---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

`createSecretsFeature` throws at mount when both `access` and `roles` are passed; `access` used to silently discard `roles`. The personal-access-token mint form builds its i18n keys from the shared key helpers, and `ACTION_FORM_ENTITY` is now exported from `@cosmicdrift/kumiko-framework/ui-types`. The rate-limiting feature registers de/en copy for its error keys.

<!-- kumiko-changes
feature: secrets
type: breaking
title: createSecretsFeature rejects access and roles together
migration: |
  Remove `roles` from the `createSecretsFeature` options when `access` is set (or drop `access` and keep `roles`). Before, `roles` was silently ignored next to `access`.
-->

<!-- kumiko-changes
feature: rate-limiting
type: fix
title: Rate-limiting error keys have de/en translations
-->
