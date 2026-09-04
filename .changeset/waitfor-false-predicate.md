---
"@cosmicdrift/kumiko-framework": patch
---

`waitFor` now polls when a callback returns `false` (a boolean-predicate style), not only when it throws — a non-throwing predicate previously returned after a single call without ever waiting.
