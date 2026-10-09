---
"@cosmicdrift/kumiko-framework": patch
---

event-store-executor list: the search path now asks the SearchAdapter for up to 1000 candidate ids instead of the adapter's default 50, so hits beyond the 50th are no longer silently dropped. A search matching more than 1000 documents fails with 422 `search_too_many_results`.
