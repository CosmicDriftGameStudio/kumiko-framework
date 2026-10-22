---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
---

Password reset and signup accept an optional `returnTo` path that is carried through the mailed link and the web screens.

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: Optional returnTo for password reset and signup
detail: Password reset and signup accept an optional returnTo path. A safe value (same-origin path, no dot segments) is appended to the mailed link as a query parameter, the reset and signup-complete screens follow it, and the login screen forwards its next to the forgot-password and signup links. Invalid values are dropped silently and never block the mail. isSafeReturnPath and readReturnToFromSearch are exported from the web barrel. isSafeNextPath now uses the same check, so a next with a dot segment such as "/a/../b" is no longer followed.
-->
