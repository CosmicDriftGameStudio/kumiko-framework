---
"@cosmicdrift/kumiko-bundled-features": minor
---

document-ingest-foundation records the text recognition progress per file, so a provider can report finished pages and an app can show "page 2 of 3".

<!-- kumiko-changes
feature: document-ingest-foundation
type: improvement
title: Ingest progress per file via reportIngestProgress
detail: reportIngestProgress(deps, { fileRefId, pagesDone, pagesTotal }) appends a documentIngest.progress event to the file's ingest stream and runs the ingest-progress projection, which keeps one row per file in store_document_ingest_progress (documentIngestProgressTable, read by tenantId and fileRefId). The payload is validated by documentIngestProgressPayloadSchema (pagesTotal at least 1, pagesDone not above pagesTotal). Provider jobs still trigger only on documentIngest.requested. Apps need a migration for the new table.
-->
