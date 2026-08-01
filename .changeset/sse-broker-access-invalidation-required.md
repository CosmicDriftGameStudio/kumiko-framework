---
"@cosmicdrift/kumiko-framework": minor
---

**BREAKING:** `SseBroker.subscribeAccessInvalidation` and `.publishAccessInvalidation` are now required instead of optional. An app-injected `SseBroker` (e.g. a Redis-backed multi-replica broker) that omitted them made the mid-stream access-teardown security control (#1561) a silent no-op — a revoked session kept receiving live SSE data with no error or log. A custom `SseBroker` implementation needs to add both methods; a no-op stub (`subscribeAccessInvalidation: () => () => {}`, `publishAccessInvalidation: () => {}`) is enough for a broker that genuinely doesn't need cross-instance invalidation.
