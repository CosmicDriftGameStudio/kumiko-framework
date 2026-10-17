---
"@cosmicdrift/kumiko-framework": patch
---

Moving a file id between two file fields of one record no longer deletes the file

<!-- kumiko-changes
feature: framework
type: fix
title: Moved file ids are not disposed
detail: disposeRemovedFileRefs now collects the file ids still stored in any file field of the saved record before soft-deleting removed ones, so an id moved from one field to another stays readable.
-->
