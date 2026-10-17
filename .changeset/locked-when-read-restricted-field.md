---
"@cosmicdrift/kumiko-framework": patch
---

Boot validation rejects a lockedWhen field with a read restriction

<!-- kumiko-changes
feature: framework
type: fix
title: lockedWhen on a field with access.read fails at boot
detail: Roles that cannot read the lock field receive records without it, and the client then showed every record as locked. validateLockedWhen now rejects a lock field that declares access.read.
-->
