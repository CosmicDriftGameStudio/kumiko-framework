---
"@cosmicdrift/kumiko-headless": patch
---

Untouched optional fields seeded with "" are dropped from the submit payload in payloadMode "values" instead of being sent as an empty string, which a `.optional()` server schema rejects.
