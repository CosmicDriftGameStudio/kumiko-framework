---
"@cosmicdrift/kumiko-framework": patch
---

`backfillEventPiiEncryption`'s new owner-resolution chain (payload → projection row → erase, fw#2266) now pins the payload-wins-over-projection precedence and the value-guard skip for pii fields absent from an event section, both with dedicated integration tests.
