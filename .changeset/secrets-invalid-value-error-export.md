---
"@cosmicdrift/kumiko-bundled-features": minor
---

`secrets` exports `isInvalidSecretValueError`, which recognises the validation error that `secrets:write:set` and `ctx.secrets.set` raise when a value fails the key's `valueSchema`. It also exports `SECRETS_ERROR_KEYS` (the i18n keys of the secrets write errors) and `INVALID_SECRET_VALUE_CODE` (the field error code), so callers can map the failure to their own message instead of matching strings.

<!-- kumiko-changes
feature: secrets
type: improvement
title: Recognise the invalid-secret-value error
-->
