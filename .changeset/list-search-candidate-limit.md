---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

event-store-executor list: the search path now asks the SearchAdapter for up to 1000 candidate ids instead of the adapter's default 50, so hits beyond the 50th are no longer silently dropped. When the adapter returns the full 1000 (Meilisearch's maxTotalHits cap), the list result carries `searchTruncated: true` (new optional field on `CursorResult`) so clients can tell the match set may be incomplete.
