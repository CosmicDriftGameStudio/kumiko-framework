---
"@cosmicdrift/kumiko-bundled-features": patch
---

Self-signup and both invite acceptances now put the app's auth claims into the first session, like a regular login.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Signup and invite sessions carry the auth claims
detail: `signup-confirm`, `invite-signup-complete` and `invite-accept-with-login` built their session without running the `r.authClaims` hooks, so the first JWT after these flows had no `claims` until the user logged in again or switched tenants. They now mint the session the same way `login` does; roles, tenant, locale and timezone stay as before.
-->
