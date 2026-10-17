---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
---

Cascade deletes honour the record-lock exemptions and ignore soft-deleted children

<!-- kumiko-changes
feature: framework
type: fix
title: Cascade deletes honour the record-lock exemptions and ignore soft-deleted children
detail: The cascade hook blocked a parent delete on a locked child even when the executor delete had skipped the lock guard (unsafeSkipLockGuard, a framework system write with a writePurpose, forget). DeleteContext now carries lockGuardBypassed and the hook follows it. Soft-deleted children no longer count as locked.
-->
