---
"@cosmicdrift/kumiko-framework": minor
---

`POST /files` with an `entityId` now requires that the caller may write that record, checked before any byte is stored. The record must be readable (else 404 `not_found`), the entity's update handler, entity `access.write` and the file field's write access must allow the caller (else 403), and the record must not be locked by `lockedWhen` (else 409 `record_locked`). Before, any signed-in user of the tenant could attach files to any entityId, including records they could not read or that did not exist. An `entityId` without an `entityType` is rejected with 400 `missing_entity_type`. A custom `accessGuard` does not replace this check.

Migration: apps that attach files to records the uploader may not update must grant the update right or upload without an `entityId` and bind on save. An entity without a generic `:update` handler rejects uploads that carry an `entityId`. Uploads that used `entityId` as a free slot without a stored record (as the files-post-processing sample did) must create the record first.

<!-- kumiko-changes
feature: framework
type: breaking
title: POST /files checks write access to the target record
detail: createRecordWriteCheck loads the stored row tenant-scoped and applies update-handler access, entity access.write, field write access and lockedWhen before the upload is stored. Results map to 404, 403 and 409 record_locked. Uploads with an entityId and no check wired are refused.
migration: Grant the uploader the entity's update right for records they attach files to, or upload without an entityId and bind the file on save. Entities without a generic :update handler no longer accept uploads with an entityId. Code that used entityId as a free slot without a stored record must create the record first.
-->
