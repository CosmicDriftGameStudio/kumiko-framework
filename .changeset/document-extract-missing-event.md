---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-guards": patch
---

`appendMissingDocumentExtractEvent` lets a document-ingest provider catch up a document-extract stream that has its created event but no ready or failed event.

<!-- kumiko-changes
feature: document-ingest-foundation
type: improvement
title: appendMissingDocumentExtractEvent and shared ready/failed payload schemas
detail: A provider whose job died after creating the extract calls appendMissingDocumentExtractEvent(deps, existing, fileRefId, { readyEventQn, failedEventQn, mapError }) to append the missing terminal event; it returns appended-ready, appended-failed or already-terminal. documentExtractReadyPayloadSchema and documentExtractFailedPayloadSchema are exported so providers register their own event names with the shared payload shape.
-->
