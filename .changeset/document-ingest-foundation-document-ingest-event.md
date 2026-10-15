---
"@cosmicdrift/kumiko-bundled-features": patch
---

document-ingest events live on their own stream

documentIngest.requested/skipped were appended to the fileRef's own event stream (aggregateId = fileRefId), so the request-ingest projection racing a save that binds a pending upload broke the fileRef's optimistic lock (409 version_conflict). They now use documentIngestAggregateId(tenantId, fileRefId); payload.fileRefId is unchanged.

<!-- kumiko-changes
feature: document-ingest-foundation
type: fix
title: document-ingest events live on their own stream
-->
