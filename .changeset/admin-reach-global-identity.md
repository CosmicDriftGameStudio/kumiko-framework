---
"@cosmicdrift/kumiko-bundled-features": minor
---

A tenant admin or data protection officer can now restrict, unrestrict or forget only users who are members of their own tenant alone and do not outrank them.

<!-- kumiko-changes
feature: user-data-rights
type: breaking
title: Tenant admins act only on users within their own reach
detail: `restrict-account` (for another user), `lift-restriction` and `forget-subject` with `kind: "user"` act on global user data (status, sessions, key). A tenant admin or data protection officer may now run them only for users who are members of their own tenant and no other, and who hold no role above their own rank. Otherwise the call fails with 403 and the reason `target_user_in_other_tenants` or `target_user_outranks_actor`. `forget-subject` (crypto-shredding) falls back to the subject's own row only for subjects without any membership. Targets holding a platform role (SystemAdmin) are not reachable for tenant admins and data protection officers. A SystemAdmin is unchanged. Without the user feature mounted there is no user row, so the global-role checks are skipped and only the membership-derived checks apply.
migration: Cases that involve users with memberships in several tenants, or users with a higher role, are run by a SystemAdmin. `denyIfTargetOutsideAdminTenant` is replaced by `denyIfTargetBeyondAdminReach` (same call shape plus a required fourth parameter `userFeatureMounted`; the bundled handlers pass `ctx.registry.features.has("user")`).
affects: user-data-rights, denyIfTargetOutsideAdminTenant, restrict-account, lift-restriction, forget-subject
-->
