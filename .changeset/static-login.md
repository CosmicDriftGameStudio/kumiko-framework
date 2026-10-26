---
"@cosmicdrift/kumiko-bundled-features": minor
---

DOM-free login helpers for static marketing sites.

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: static-login subpath for static sites
detail: `@cosmicdrift/kumiko-bundled-features/auth-email-password/static-login` imports neither React nor the renderer. It offers `loginWithPassword` and `verifyMfaCode` (same requests as the SPA login, one result union with success, mfa-challenge, mfa-setup-required and failure incl. network and rate limit), `appReturnPath` and `postLoginPath` for the `next` filter, `forgotPasswordHref`, and `marketingLoginUrl({ localePaths, isAppPath })`, a `LoginUrlBuilder` for the auth gate that sends visitors to the marketing login with `next`. `LoginUrlBuilder` and `failureFromErrorField` are now exported from `auth-email-password/web`.
-->
