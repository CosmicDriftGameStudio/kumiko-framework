---
"@cosmicdrift/kumiko-bundled-features": patch
---

fw#2608: `user-data-rights` no longer latches a tenant to `multi-user` when its sole member was removed and re-added. The historical membership check now compares created-events against those with a *readable* `userId` instead of against the distinct-identity count, so repeated memberships of the same person stay `single-user` and `tenantScopedOnly` erase hooks keep running. Events with an unreadable/empty `userId` still fail safe to `multi-user`.
