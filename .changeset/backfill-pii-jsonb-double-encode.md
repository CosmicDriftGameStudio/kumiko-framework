---
"@cosmicdrift/kumiko-framework": patch
---

Fix `backfillEventPiiEncryption` writing the re-encrypted event payload as a double-encoded jsonb string instead of a jsonb object. `loadAggregate` masked this because its typed read path re-parses string-shaped jsonb columns, but raw SQL consumers (GDPR exports, MSP replays) saw corrupted data.
