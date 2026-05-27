---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Make `fileRef` a standard event-sourced entity. Uploads and deletes now go through the standard entity executor (emitting `fileRef.created` / `fileRef.deleted`, materialised via `applyEntityEvent`) instead of the previous custom `files:event:*` events + bespoke inline projection. `file_refs` is built via `buildEntityTable` (single source of truth) and the entity opts into `softDelete`, so delete / anonymize / retention behaviour now comes from the generic entity lifecycle + `data-retention` + forget pipeline — there is no file-specific retention logic.

BREAKING: `files:event:uploaded`, `fileUploadedEvent`, `fileUploadedPayloadSchema`, `FileUploadedPayload` and `FILE_UPLOADED_EVENT_TYPE` are removed from `@cosmicdrift/kumiko-framework/files`. Consumers (e.g. multi-stream projections) that subscribed to `files:event:uploaded` must subscribe to the entity auto-verb events `fileRef.created` / `fileRef.deleted` instead. `createFilesFeature` now lives in the framework and is re-exported from `@cosmicdrift/kumiko-bundled-features/files`, so that import path is unchanged.
