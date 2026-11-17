---
"@cosmicdrift/kumiko-bundled-features": minor
---

`reportIngestProgress` takes the caller's TenantDb and writes the progress row directly instead of appending a `documentIngest.progress` event.

<!-- kumiko-changes
feature: document-ingest-foundation
type: breaking
title: Ingest progress is a direct store write on the TenantDb
detail: `reportIngestProgress(db, { fileRefId, pagesDone, pagesTotal })` now takes a `TenantDb`, so providers no longer need `unsafeRaw()`. Progress is display-only, so it no longer appends one event per batch: the event `documentIngest.progress` and the projection `ingest-progress` are gone, and `store_document_ingest_progress` is a direct-write store table with a unique index on `(tenant_id, file_ref_id)`. pagesDone still only moves forward, also for parallel or out-of-order reports. The exports `DOCUMENT_INGEST_PROGRESS_EVENT_QN`, `DOCUMENT_INGEST_PROGRESS_EVENT_SHORT` and `ReportIngestProgressDeps` are removed. Progress events already stored stay in the event store and are ignored.
migration: Call `reportIngestProgress(tenantDb, input)` instead of `reportIngestProgress({ db: tenantDb.unsafeRaw(), registry, tenantId, actorId }, input)`. Apps that mount document-ingest-foundation run `kumiko-schema generate` and ship the migration that replaces the index `store_document_ingest_progress_tenant_id_file_ref_id_idx` with the unique index `store_document_ingest_progress_tenant_file_ref_unique`.
affects: document-ingest-foundation, reportIngestProgress, ReportIngestProgressDeps, DOCUMENT_INGEST_PROGRESS_EVENT, documentIngest.progress
-->
