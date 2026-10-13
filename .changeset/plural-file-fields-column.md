---
"@cosmicdrift/kumiko-framework": minor
---

Plural file fields (`createFilesField`, `createImagesField`) are stored in a projection column. The column is `jsonb NOT NULL DEFAULT '[]'`, like `multiSelect`, and holds the ordered array of file ids. `<entity>:detail` and `<entity>:list` now return the array, so `FileListField` shows the stored files of a saved record instead of "No files yet." A `personal` annotation on a plural file field now works: the array is encrypted as a ciphertext JSON string, like a `personal` jsonb field. Before, such a write failed because only strings were encrypted.

<!-- kumiko-changes
feature: framework
type: breaking
title: Plural file fields have a projection column
detail: files and images fields get a jsonb NOT NULL DEFAULT '[]' column on the entity table (entity-table-meta, buildEntityTable row type readonly string[]) and applyEntityEvent no longer strips them from updated events. Detail and list queries return the ordered id arrays; before, they never carried the field, so an edit form of a saved record showed no files. A personal annotation on files/images encrypts the array as a jsonb ciphertext string. kumiko schema generate emits an in-place ADD COLUMN for existing tables and no .rebuild.json, so existing rows hold [] until their projection is rebuilt from the events.
migration: Run kumiko schema generate and apply the migration. Existing rows keep [] until the entity projection is rebuilt, so add a rebuild marker before applying: create <NNNN_migration-name>.rebuild.json next to the generated SQL with {"version":1,"tables":["<table name from the ALTER TABLE statement>"]}; kumiko schema apply then rebuilds the projection. Without the marker, call enqueueProjectionRebuild("<feature>:projection:<entity>-entity", { db, registry, jobRunner }) from @cosmicdrift/kumiko-framework/migrations once per entity. Known consumers: solon protocol (attachmentFileIds) and the Wartungs-Demo (photos). Code that read the ids of a plural file field from the event log or from file_refs can read the row field instead.
-->
