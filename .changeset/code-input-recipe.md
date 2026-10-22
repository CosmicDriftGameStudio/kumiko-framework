---
"@cosmicdrift/kumiko-framework": patch
---

The auth-mfa recipe shows the code input outside the MFA screens.

<!-- kumiko-changes
feature: framework
type: improvement
title: Recipe for Input kind "code" in a confirmation step
detail: samples/recipes/auth-mfa has a ConfirmationCodeStep for e-mail or invite codes that uses Input kind "code" with length, autoFocus and onComplete, clears and refocuses after a rejected code, and has a DOM test. The agent example for auth-mfa includes it.
-->
