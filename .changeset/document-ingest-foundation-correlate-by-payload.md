---
"@cosmicdrift/kumiko-bundled-features": patch
---

Ingest events: correlate by event type and payload.fileRefId

<!-- kumiko-changes
feature: document-ingest-foundation
type: fix
title: Ingest events: correlate by event type and payload.fileRefId
detail: New documentIngest events live on their own stream while older ones stay on the fileRef stream (aggregateId = fileRefId). Consumers must not correlate by aggregateId or the fileRef stream version.
-->
