---
"@cosmicdrift/kumiko-framework": minor
---

An update that removes or replaces an id in a `file`, `image`, `files` or `images` field now deletes the dropped fileRef, so readers of the record get 404 for it. Before, the fileRef stayed bound to the record and readable by everyone who could read it. The delete is the one `DELETE /files/:id` uses (soft delete, binary kept until retention), runs in the save's transaction and only touches fileRefs bound to exactly this record and field. Pending, shared or elsewhere-bound ids in the previous value are left alone. Deleting a whole record does not dispose its files in this step.

<!-- kumiko-changes
feature: framework
type: improvement
title: Files removed from a record are deleted
detail: disposeRemovedFileRefs runs next to bindPendingFileRefs for every save that is not a create. For each file field named in changes it soft-deletes the fileRefs present in previous but not in the saved row, when entityType, entityId and fieldName match this record. The binary stays until retention or forget.
-->
