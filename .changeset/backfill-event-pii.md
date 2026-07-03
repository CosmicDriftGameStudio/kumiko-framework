---
"@cosmicdrift/kumiko-framework": minor
---

`backfillEventPiiEncryption(db, registry, { batchSize?, dryRun? })` (#799): one-time in-place re-encrypt of pre-KMS plaintext PII in `kumiko_events` — entity lifecycle payloads (created / updated changes+previous / deleted/forgotten/restored previous) and catalogued custom events (`defineEvent piiFields`). Idempotent (`kumiko-pii:` values pass through); already-forgotten subjects get `[[erased]]` instead of a freshly minted key, detected via KMS tombstone (KeyErasedError) or the stream's `*.forgotten` event (pre-KMS forgets). Snapshots of touched aggregates are dropped. Run the projection rebuilds afterwards — `applyEntityEvent` materializes ciphertext plus blind-index columns, keeping login-by-email alive. Also new: `registry.getAllEntities()`.
