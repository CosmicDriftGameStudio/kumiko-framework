---
"@cosmicdrift/kumiko-bundled-features": patch
---

`document-ingest-foundation` exports `writeIngestPages` / `readIngestPages` so providers serialize `IngestPage[]` into the encrypted `pages` longText column (and parse it back) instead of treating the field as jsonb.
