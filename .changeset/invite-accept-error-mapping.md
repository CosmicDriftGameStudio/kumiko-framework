---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

The invitation page shows a readable message for each failure and picks login or signup from the invitation.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Invitation page translates server errors and chooses the form from invite-info
detail: `InviteAcceptScreen` showed the raw key `auth.errors.invalidInviteToken` for every failed accept, even a wrong password. It now maps the server's reason per code (invalid credentials, wrong invited email, rejected password, rate limit, invalid or used link) and falls back to the generic error. The keys `invalidInviteToken`, `inviteEmailMismatch`, `inviteAlreadyAccepted` and `passwordRejected` were missing in every locale bundle and are added to en, de, es, fr and it. When the app mounts the invite-info route (`invite.infoHandler`), the page also prefills the invited email, opens the signup form for invitees without an account and shows an error card for an invalid link.
-->
