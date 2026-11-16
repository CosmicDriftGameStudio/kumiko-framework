---
"@cosmicdrift/kumiko-guards": patch
---

The tenant-escalation guard checks handlers registered with r.writeHandler and accepts only real strip calls at JWT mints.

<!-- kumiko-changes
feature: guards
type: improvement
title: Tenant-Escalation Guard covers r.writeHandler
detail: The role-input check and the cross-tenant user-write check now also cover `r.writeHandler({ ... })`, not only `defineWriteHandler`. At a JWT mint built from membership roles, only a call to `stripForbiddenMembershipRoles` or `buildSessionRoles` counts; a mention in a comment no longer does, and mint and membership patterns inside comments are ignored.
-->
