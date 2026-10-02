---
"@cosmicdrift/kumiko-framework": patch
---

`rebuildMultiStreamProjection` now accepts an `AbortSignal` and checks it per replayed event. The boot backfill's shutdown signal reaches it, so a SIGTERM during a long multi-stream replay rolls the transaction back and releases the consumer lock instead of hanging until the pod is killed.

<!-- kumiko-changes
feature: framework
type: fix
title: Multi-stream projection rebuild honors the shutdown AbortSignal
-->
