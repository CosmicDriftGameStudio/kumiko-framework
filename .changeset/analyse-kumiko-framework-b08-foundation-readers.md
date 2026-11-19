---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

document-ingest-foundation exports readers for extracts and progress, a bounded byte reader and one call that writes an extract with its terminal event.

<!-- kumiko-changes
feature: document-ingest-foundation
type: improvement
title: Extract readers, readDocumentBytes and completeDocumentExtract
detail: `loadDocumentExtract({ db, user }, fileRefId)` returns the newest extract of a file with its decrypted pages, or null when there is none or its record key was erased. `listDocumentExtractSummaries(db, fileRefIds)` returns id, meta and `hasError` of the newest extract per file from plaintext columns only, and `loadDocumentIngestProgress(db, fileRefId)` returns pagesDone and pagesTotal. `readDocumentBytes(storage, storageKey, maxBytes)` stops reading once the limit is exceeded and returns "too-large". `completeDocumentExtract(deps, { fileRefId, storageKey, pages, meta }, options)` writes the extract and appends the ready event, or the failed event when `meta.error` is set, and catches up the event of an earlier delivery that wrote the extract but died before the event.
migration: Providers replace their own bounded read, their write plus `events.append` and their pre-check with `readDocumentBytes` and `completeDocumentExtract`; apps that built their own `documentExtract` executor or read `documentExtractsTable` or `documentIngestProgressTable` use the readers instead.
-->

inbound-mail-foundation exports a decrypting envelope reader.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: improvement
title: loadInboundMessageEnvelope
detail: `loadInboundMessageEnvelope({ db, user }, messageId)` returns from, to, subject, snippet, ownerUserId and threadKey of one received mail, decrypted, with `to` as a string array. It applies the visibility of `message:content`: a personal mailbox is readable by its owner and by the system user only. It returns null when the mail is gone, hidden from the caller or its tenant key was erased.
migration: Apps that decrypt rows of `inboundMessagesProjectionTable` with `INBOUND_MESSAGE_PII_FIELDS` themselves call `loadInboundMessageEnvelope` instead and pass the user they run as.
-->

The files module exports purgeFileRef.

<!-- kumiko-changes
feature: framework
type: improvement
title: purgeFileRef removes a file's bytes and row in one call
detail: `purgeFileRef({ db, user, files }, fileRefId, { entityType })` deletes the original and its derivatives, then forgets the fileRef row. When storage is missing or a delete fails it soft-deletes the row instead, so the soft-delete cleanup finishes later, and reports `left-to-cleanup` with `bytesDeleted` and `rowSoftDeleted`. It returns `not-found` for an unknown or foreign id and `bound-elsewhere` when `entityType` is given and does not match. It never throws on a failed delete.
migration: Replace hand-written sequences of `deleteFileRefBytes`, `forget` and soft delete with `purgeFileRef`.
-->
