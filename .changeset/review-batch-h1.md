---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-testing": minor
---

Review batch H1: framework parts of consumer-app findings.

- `auth-email-password` exports `issueSignupActivation` (invalidate, mint, store and mail an activation link; the signup-request handler now runs on it), `SIGNUP_ACTIVATION_NOTIFICATION_TYPE`, `storeSignupToken`, `invalidateExistingSignupToken`, `normalizeEmail` and `SIGNUP_TOKEN_KEY_PREFIXES`.
- `auth-mfa` declares the master-key env slots (`KUMIKO_SECRETS_MASTER_KEY_V1`, `_CURRENT_VERSION`, the `_CIPHERTEXT` twin) as a shared fragment with `secrets`, so a rotated `V<n>` slot is unpacked even without `secrets` mounted.
- `user-data-rights` exports `TENANT_MODEL_CONFIG_KEY`; `createTemplateResolverApi` takes a `DbRunner`.
- The user menu's logout item carries `data-testid="user-menu-logout"`.
- renderer-web: a `Field` description is linked to its text input via `aria-describedby`; the facet filter dropdown is capped to the available viewport height and scrolls; `createBrowserLocaleResolver` takes `normalizeLocale` and the default storage key is exported as `BROWSER_LOCALE_STORAGE_KEY`.
- testing: `loginViaApi(request, credentials, { bucketKey })`, `CLIENT_IP_HEADER` from `@cosmicdrift/kumiko-testing/e2e`, and a Playwright-free `@cosmicdrift/kumiko-testing/e2e/constants` subpath (`KUMIKO_SECRETS_MASTER_KEY_V1`).

<!-- kumiko-changes
feature: auth-mfa
type: breaking
title: auth-mfa declares the master-key env slots, so composeEnvSchema requires KUMIKO_SECRETS_MASTER_KEY_V1 when auth-mfa is mounted
migration: Apps that bring their own masterKey provider instead of the env KEK add "auth-mfa" to composeEnvSchema's optionalFeatures, like they already do for "secrets".
-->
