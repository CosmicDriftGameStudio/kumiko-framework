---
"@cosmicdrift/kumiko-dispatcher-live": minor
---

Command idempotency by default (#761): the live dispatcher now generates a `requestId` for every `write()` and `batch()` invocation when the caller does not pass one, so the server-side dedup (Redis SET NX pending-lock + cached result) always engages. A transport-level double-send no longer duplicates events. Explicit `requestId`s (logical-submit ids reused across retries) keep taking precedence. Uses `crypto.randomUUID` where available with a `Math.random` fallback for React-Native runtimes without the WebCrypto polyfill.
