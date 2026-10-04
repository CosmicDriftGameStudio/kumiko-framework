---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`invite-signup-complete` now applies the same MFA gate as `invite-accept-with-login`. The account is still created and the invitation accepted, but an invitee whose role requires MFA (for example an admin invitation under the `admins` policy) receives the MFA step instead of a session. Member invitations keep receiving a session directly.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: invite-signup-complete enforces the MFA gate before issuing a session
-->
