---
"@cosmicdrift/kumiko-framework": patch
---

`GET /files/:id` and the download-url route now fall back to the filename "download" when the stored fileName cannot be decrypted (malformed ciphertext, erased subject, annotation drift) instead of returning 500 or leaking ciphertext into headers. `loadAggregate` rejects an empty `aggregateType` instead of loading the unfiltered stream, and `appendProvenanceEvent` rejects event types with an empty owner or name.

<!-- kumiko-changes
feature: framework
type: fix
title: File byte routes survive undecryptable fileName; loadAggregate and appendProvenanceEvent reject empty type parts
-->
