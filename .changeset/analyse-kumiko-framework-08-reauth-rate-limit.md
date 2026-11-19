---
"@cosmicdrift/kumiko-bundled-features": patch
---

Password, email, access-token and MFA re-authentication can be tried at most five times per user in five minutes.

<!-- kumiko-changes
feature: auth-mfa
type: improvement
title: Re-authentication handlers are rate limited per user
detail: `change-password`, `user-profile:change-email`, `personal-access-tokens:create`, `auth-mfa:disable` and `auth-mfa:regenerate-recovery` verify a password or second factor without a limit until now, so a stolen session could guess without bound. Each now allows 5 calls per user per 5 minutes and then answers 429 `rate_limited`. A code that cannot be a recovery code (for example a mistyped 6-digit TOTP) no longer runs the argon2 recovery-code check, and the TOTP-only MFA verifier used by access-token creation never runs it.
-->
