---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

`InviteAcceptScreen` no longer redirects to a tenant URL when the accept route answers with an MFA challenge or setup requirement (no session cookie was minted); it sends the user to `loginHref` instead. `SessionBootstrapErrorScreen` accepts an optional `onSignOut` and the auth gate wires it, so a permanent bootstrap failure no longer traps the user behind "Try again" (new i18n key `auth.sessionBootstrap.signOut`). Cap bookings back off with a small random delay between version-conflict retries.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Invite accept handles MFA responses, bootstrap error screen offers Sign out
-->
