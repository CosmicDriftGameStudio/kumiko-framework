---
"@cosmicdrift/kumiko-framework": patch
---

`rebuildMultiStreamProjection` reads the event log in batches of 1000 instead of loading every subscribed event up to the horizon at once.

<!-- kumiko-changes
feature: projections
type: fix
title: Multi-stream projection rebuild reads events in batches
detail: The rebuild of a multi-stream projection used to select every subscribed event up to the replay horizon in one query and kept the id of every replayed event in memory, so a projection over frequent event types could run the pod out of memory during `kumiko-schema apply` or the rebuild job. It now reads keyset batches of 1000 events (`id > last read id AND id <= horizon`) inside the same transaction and carves each batch's ids out of the seeded pending gaps right away. Replay order, the horizon handoff to the live dispatcher, the shadow swap and the result counts stay the same.
-->
