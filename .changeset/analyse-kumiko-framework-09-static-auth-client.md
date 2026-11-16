---
"@cosmicdrift/kumiko-bundled-features": minor
---

The static login and the web auth client's token flows send their requests through the shared static-client request core.

<!-- kumiko-changes
feature: auth-email-password
type: breaking
title: One request core for the static login and the token flows
detail: `loginWithPassword` and `verifyMfaCode` from `auth-email-password/static-login` now use `postJson` from `auth-email-password/static-client` and answer as before; a signed-in visitor's CSRF cookie is now sent along. `requestPasswordReset`, `resetPassword`, `requestEmailVerification`, `verifyEmail`, `requestAccountUnlock`, `confirmAccountUnlock`, `requestSignup` and `confirmSignup` from the web auth client no longer throw when the network fails; they return `{ ok: false, error: { reason: "network" } }`. A 401 without an error code now gives the reason `unauthenticated`, and a token rejected only by the schema gives `malformed_token`. `static-login` no longer exports `STATIC_NETWORK_FAILURE_REASON` and `STATIC_RATE_LIMITED_REASON`.
migration: Import `STATIC_NETWORK_REASON` and `STATIC_RATE_LIMITED_REASON` from `@cosmicdrift/kumiko-bundled-features/auth-email-password/static-client` instead; the values are the same (`"network"`, `"rate_limited"`).
-->
