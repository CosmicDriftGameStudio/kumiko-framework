---
"@cosmicdrift/kumiko-bundled-features": patch
---

The boot admin seed no longer grants roles, memberships or a verified email to an existing unverified account that cannot prove it owns the seed identity.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: boot admin seed ignores unverified accounts that squat the seed email
detail: `seedAdminGuarded` (demoAdmin, sysadmin, auth.admin boot seeds) reconciled `emailVerified` and added memberships for any existing account with the seed email, so a self-registered, unverified account with a foreign password became the admin on the next boot. For an existing row it now requires `emailVerified === true` or a seed password that verifies against the stored hash; otherwise it logs a warning and returns the id untouched. An explicit caller guard (`seedBootstrapAdmin`, passwordless own account) still replaces this check.
-->
