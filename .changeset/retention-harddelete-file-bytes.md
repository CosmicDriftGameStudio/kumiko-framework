---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
---

data-retention hardDelete now purges file bytes + fileRef rows, not just the entity row (fw#3089)

<!-- kumiko-changes
feature: data-retention
type: breaking
title: data-retention hardDelete now purges file bytes + fileRef rows, not just the entity row (fw#3089)
migration: |
  hardDelete previously deleted only the entity row and left every file/image/files/images field's storage bytes and `file_refs` row behind — a DSGVO Art. 17 gap. As of this release, an expired row's un-shared fileRefs (same tenant, bound to this row, not referenced by another row of the same entity) have their storage bytes deleted (including derivatives/thumbnails), then their `file_refs` row, then the entity row itself. A fileRef still referenced by another row, or bound to a different entity/record, is left untouched. Without a resolvable file-storage provider in the retention cron's job context, an entity with pending file deletions is skipped entirely (`skipped` reason `missing_file_storage`) rather than silently dropping the row with orphaned bytes; a storage-delete failure skips the row too (`file_delete_failed`) and retries on the next run. Before upgrading, a consumer relying on hardDelete NOT touching file storage should: list entities with `retention.strategy: "hardDelete"` and at least one file/image/files/images field, count rows already past `keepFor` for each, and confirm the referenced files are safe to delete (not needed elsewhere) before the next cron run.
-->
