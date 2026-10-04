---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

`POST /auth/signup-confirm` now runs the login's MFA gate before it issues the first session. Self-signup makes the new user TenantAdmin of a fresh tenant, so under an MFA policy that covers admins the route used to hand out an admin session without a second factor. The account, the tenant and a bound handover claim are still created, but when the gate applies the route answers with the login contract (`mfaSetupRequired` plus `preauthSetupToken`, or `mfaRequired` plus `challengeToken`) and sets no cookies. `SignupCompleteScreen` then tells the user the account is active and sends them to sign in, where they set up the second factor. Without `mfaStatusChecker` nothing changes. Two exported types change shape: `SignupConfirmData` gains the two MFA variants, and `confirmSignup` now resolves to `SignupConfirmResult` with `kind: "signed-in"` (the previous `SignupConfirmSuccess` fields) or `kind: "mfa-pending"`. The handler and `invite-signup-complete` also run the gate before they delete the token, so an error in the MFA check leaves the link usable for a retry.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: signup-confirm enforces the MFA gate before issuing a session
-->
