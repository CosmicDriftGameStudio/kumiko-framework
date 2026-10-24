---
"@cosmicdrift/kumiko-server-runtime": patch
---

The admin seeded through `auth.admin` is created with `emailVerified: true`, so it can log in under `emailVerificationMode: "strict"` (the account is operator-created, not a self-registration). An explicit `emailVerified` on the seed still wins; re-running the seed also marks an existing unverified seed admin as verified.

<!-- kumiko-changes
feature: server-runtime
type: fix
title: auth.admin seed admin is email-verified
detail: Under emailVerificationMode strict the seeded admin failed login with email_not_verified.
-->
