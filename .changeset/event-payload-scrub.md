---
"@cosmicdrift/kumiko-framework": minor
---

`scrubEventPayloadFields(db, registry, { eventType, fields, reason, shouldScrub?, dryRun? })` from `@cosmicdrift/kumiko-framework/migrations` replaces chosen payload fields of stored events with `[[erased]]` and rebuilds the projections fed by them, for personal data that crypto-shredding cannot reach.

<!-- kumiko-changes
feature: framework
type: improvement
title: Scrub primitive for event payload fields
detail: Plaintext written before a field was declared personal without a subject to erase, or a ciphertext that no longer decrypts, stayed in `kumiko_events`, and the only way out was a raw `UPDATE` on the event store, which the event-store-writes guard rejects. The scrub walks the events of one type in batches, reaches the `changes` and `previous` sections of entity lifecycle events, lets `shouldScrub(value, candidate)` narrow the values (for example to those that throw `PiiCiphertextCorruptError`), drops the snapshots of touched streams and queues the affected projection and multi-stream projection tables in `kumiko_pending_rebuilds` in the same transaction, then rebuilds them; a failed rebuild stays queued. `reason` is required and placeholders are refused; `dryRun` only counts.
-->
