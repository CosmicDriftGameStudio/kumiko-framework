---
"@cosmicdrift/kumiko-renderer": patch
---

`entityEdit` create screens with `redirect` set now carry the newly created record's id along as the target screen's `entityId`, instead of dropping it. Previously, a redirect to an entity-scoped screen (e.g. a detail/update view) landed there with no `entityId`, silently rendering an empty create form instead of the just-created record. `extractCreatedId` (already used by `ReferenceCreateDialog`) is now exported and reused here to read the id off the write handler's success payload.
