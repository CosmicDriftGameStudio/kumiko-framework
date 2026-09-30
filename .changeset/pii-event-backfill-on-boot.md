---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

runProdApp and runWorkerApp re-encrypt plaintext events after a field gains a PII annotation

When an event field is annotated as PII after events were already stored, the stored payloads stay plaintext because a projection rebuild copies them unchanged. After start, `runProdApp` and `runWorkerApp` now run `runPiiEventBackfill` in the background: it encrypts those events in place once per annotation state, queues the affected projections (including multi-stream projections with their own table) in `kumiko_pending_rebuilds` and rebuilds them, so ciphertext and blind-index columns get materialized. Later boots only run a cheap catch-up over the newest events. Replicas are serialized by an advisory lock, each batch commits on its own, and failed events are logged and retried on the next boot. Progress lives in the new table `kumiko_pii_backfill_state`, created on first run. Behavior change: the first boot after the bump rewrites `kumiko_events` payloads for annotated fields; set `KUMIKO_SKIP_PII_BACKFILL=1` to opt out. Calling `backfillEventPiiEncryption` by hand stays necessary for `eraseUnresolvableSubjects`, which the boot run never sets. `backfillEventPiiEncryptionBatch` is the new single-batch primitive both build on. `runPendingRebuilds` (the schema-apply queue drain) now also rebuilds queued multi-stream projection tables instead of failing on them; a failed multi-stream rebuild in either path stays queued and leaves the live consumer running.

<!-- kumiko-changes
feature: framework
type: improvement
title: runProdApp and runWorkerApp re-encrypt plaintext events after a field gains a PII annotation
-->
