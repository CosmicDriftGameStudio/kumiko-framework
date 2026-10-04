---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Signup with an MFA requirement keeps its landing path

When the MFA policy asks for a factor at self-registration, `/auth/signup-confirm` now also returns the `landingPath` that `auth.postAuthLanding` resolves for the signup flow (including a claimed handover). `SignupCompleteScreen` passes it to the login link as `?next=`, so the login that follows can land where a signup without MFA would have.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Signup-confirm under an MFA policy returns the signup landing path and the activation screen forwards it to login as next
-->
