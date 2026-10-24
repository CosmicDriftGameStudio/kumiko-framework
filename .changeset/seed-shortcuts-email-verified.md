---
"@cosmicdrift/kumiko-server-runtime": patch
---

The accounts seeded through `seeds.demoAdminFromEnv` and `seeds.sysadminFromEnv` are created with `emailVerified: true`, so they can log in under `emailVerificationMode: "strict"` (operator-created, not self-registered). An explicit `emailVerified` in the seed options still wins.

<!-- kumiko-changes
feature: server-runtime
type: fix
title: demoAdminFromEnv seed account is email-verified
detail: Under emailVerificationMode strict the seeded demo admin failed login with email_not_verified.
-->
