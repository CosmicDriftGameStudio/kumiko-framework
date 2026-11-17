---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

Locked grandchildren and locked manyToMany link rows now block a cascading delete.

<!-- kumiko-changes
feature: relations
type: fix
title: Cascade lock check decided by the root delete at every depth
detail: The cascade writes children with the lock guard skipped, and that flag used to travel into the next level, so locked grandchildren were deleted with a normal parent delete. A cascaded child now carries the root delete's lockGuardBypassed, a locked record at any depth rejects the root delete with record_locked naming the root, and locked through rows of a manyToMany cascade block the delete as well.
-->
