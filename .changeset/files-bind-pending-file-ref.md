---
"@cosmicdrift/kumiko-framework": minor
---

`loadPendingFileRef` and `bindPendingFileRef` for custom handlers

`@cosmicdrift/kumiko-framework/files` exports two helpers for handlers that create their own record from an uploaded file. `loadPendingFileRef({ fileRefId, entityName, fieldName, user, db })` returns `{ id, storageKey, mimeType, size, version }` of the caller's own unbound upload for that field, or `undefined` for a foreign, bound, deleted or wrong-field fileRef. `bindPendingFileRef({ ..., entityId })` binds it with the stream version and returns `"bound"`, `"not-pending"` or `"version-conflict"` (a parallel bind lost the race). It applies the same ownership check as the save pipeline. Anonymous callers never own an upload, so both helpers treat them as having none. The helper does not check write access to `entityId`; the handler must already be allowed to write that record.

`loadFileRefRows` now reads stream versions before the rows, so a bind that commits in between makes the second update conflict instead of overwriting the first.

<!-- kumiko-changes
feature: files
type: improvement
title: loadPendingFileRef and bindPendingFileRef bind a caller's own pending upload from a custom handler
detail: Additive. fileName is not part of PendingFileRef because it is personal data; read it via the fileRef executor's detail. Unexpected update errors throw; version_conflict and unique_violation map to "version-conflict".
-->
