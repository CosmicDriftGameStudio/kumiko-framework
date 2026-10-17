---
"@cosmicdrift/kumiko-framework": patch
---

restore reports an erased subject as a failure result

<!-- kumiko-changes
feature: framework
type: fix
title: EventStoreExecutor.restore returns a subject_erased conflict instead of throwing
detail: When the stored row has to be re-encrypted for a subject whose key was erased, restore now returns a failed WriteResult with the subject_erased ConflictError. The row stays soft-deleted and no restored event is appended. Code that called restore directly and caught the exception checks isSuccess instead.
-->
