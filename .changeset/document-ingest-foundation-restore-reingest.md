---
"@cosmicdrift/kumiko-bundled-features": patch
---

document-ingest-foundation: a restored fileRef is re-ingested, and fileRef.deleted no longer forgets an extract that is live again

<!-- kumiko-changes
feature: document-ingest-foundation
type: fix
title: document-ingest-foundation: a restored fileRef is re-ingested, and fileRef.deleted no longer forgets an extract that is live again
migration: |
  The request-ingest MSP now also reacts to fileRef.restored, parsing the entity fields from the event's `previous` snapshot and routing through the same provider-resolution/skip logic as fileRef.created — a delete→restore round-trip re-requests documentIngest.requested instead of leaving the file without an extract. forget-extract-with-file-ref's fileRef.deleted handler now checks the fileRef's current liveness (new isFileRefLive helper) before forgetting: since request-ingest and forget-extract-with-file-ref poll via separate consumer cursors, a fileRef.deleted event processed after a later restore already made the fileRef live again would otherwise forget the extract belonging to the now-live file. fileRef.forgotten still forgets unconditionally — forget stays a final Art. 17 erasure, restore on a forgotten fileRef fails NotFound as before, and no re-ingest happens for it. No consumer/action changes required.
-->
