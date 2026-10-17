---
"@cosmicdrift/kumiko-bundled-features": patch
---

seedAdminGuarded no longer appends a user:updated event on every boot

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: seedAdminGuarded rewrites the admin email only when its blind index is missing or stale
detail: rewriteSeededUserEmail returns early when the stored email blind index already matches the expected value, so repeated boots no longer re-encrypt the email and grow the user event stream. The row version is now checked with a type guard instead of a cast.
-->
