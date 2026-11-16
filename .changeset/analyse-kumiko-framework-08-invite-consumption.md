---
"@cosmicdrift/kumiko-bundled-features": patch
---

An invite link stays usable when accepting it with an existing login fails in the MFA check.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Invite handlers share one token consumption sequence
detail: `invite-accept`, `invite-accept-with-login` and `invite-signup-complete` each repeated the token lookup, burn, pending check, acceptance and token deletion. They now share one internal sequence that deletes the token only after the whole acceptance, including the MFA gate, has succeeded, and releases it again on any failure. Before, `invite-accept-with-login` deleted the token before the MFA gate, so a failing MFA check used up the link.
-->
