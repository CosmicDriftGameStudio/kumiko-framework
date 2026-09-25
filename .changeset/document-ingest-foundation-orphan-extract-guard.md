---
"@cosmicdrift/kumiko-bundled-features": patch
---

document-ingest-foundation: no documentExtract survives a deleted/forgotten fileRef, even when a provider is still writing one concurrently

<!-- kumiko-changes
feature: document-ingest-foundation
type: fix
title: document-ingest-foundation: no documentExtract survives a deleted/forgotten fileRef, even when a provider is still writing one concurrently
migration: |
  New export writeDocumentExtractForLiveFileRef(input) — providers that write documentExtract rows themselves (own executor call on ctx.db, outside the request/response flow) should write through this helper instead of calling the executor directly, and only emit their ready/failed follow-up event when the result's `kind` is "written" (a "skipped" result means the fileRef was already deleted/forgotten and nothing was written). The forget-extract-with-file-ref MSP now also reacts to documentExtract's own created event: if the extract's fileRef is not live at processing time, the consumer forgets that extract immediately. This closes the race where a provider's write and the fileRef's delete/forget interleave in either order — regardless of whether the provider uses the new helper or writes directly, no extract can now outlive its fileRef. The NotFound-tolerance check in the forget path is now a plain `error.code === "not_found"` comparison (WriteResult.error is always a plain WriteErrorInfo object, never a KumikoError instance, so `instanceof` never matched here). Test seeds of documentExtract rows with made-up fileRefIds, in any test stack that mounts document-ingest-foundation with a running dispatcher (calls runOnce), are now actively forgotten by this guard once the dispatcher processes the seed's created event — existing such seed patterns need a live (unsoftdeleted) fileRef backing the seeded fileRefId, or must avoid running the dispatcher over that event.
-->
