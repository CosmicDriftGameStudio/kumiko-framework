---
"@cosmicdrift/kumiko-framework": patch
---

A file moved between file fields is disposed when it is later removed

<!-- kumiko-changes
feature: framework
type: fix
title: Removing a file that was moved to another file field of the same record deletes its fileRef
detail: The fileRef stayed bound to the field it was first uploaded to. Once it was moved to a second field and then removed from that field, the dispose step skipped it and the file stayed readable. Dispose now accepts a binding to any file field of the same record.
-->
