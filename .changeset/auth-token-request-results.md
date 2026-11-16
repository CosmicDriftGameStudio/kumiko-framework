---
"@cosmicdrift/kumiko-bundled-features": minor
---

The password-reset, email-verification, account-unlock and signup request handlers no longer return the token or the address in their result.

<!-- kumiko-changes
feature: auth-email-password
type: breaking
title: Token request handlers no longer return the token
detail: `request-password-reset`, `request-email-verification` and `request-account-unlock` now return only `{ kind }`, and `signup-request` returns only `kind` and `expiresAt`. The result of the three token request handlers is the same for every address, known or not, so `kind: "no-op"` no longer occurs there. The token reaches the user only by mail.
migration: Code that read `token` or `email` from the result of these handlers gets the token from the sent mail instead. Checks for `kind: "no-op"` on reset, verification and unlock requests are removed. The types `TokenRequestSuccess` and `TokenRequestNoOp` no longer exist; `TokenRequestData<K>` is `{ readonly kind: K }`.
-->
