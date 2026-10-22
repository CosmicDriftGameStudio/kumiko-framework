---
"@cosmicdrift/kumiko-framework": patch
---

The access-invalidation consumer no longer ends up dead-lettered during a longer Redis outage. It keeps retrying with an exponential backoff (250 ms up to 10 s) until the publish goes through, so later revocations still reach open SSE streams once Redis is back. Only failed publishes are exempt from the attempt limit; any other failure (a poison event) still dead-letters at the dispatcher limit. `EventConsumerErrorPolicy` gains `isTransientError` for consumers that need the same split.

<!-- kumiko-changes
feature: framework
type: fix
title: Access invalidation survives a Redis outage
detail: The consumer that pushes session, token and membership revocations to open streams does not count failed publishes towards the attempt limit and backs off between them, instead of dying after 10 failed deliveries and silently dropping later revocations. Other failures keep the limit. New EventConsumerErrorPolicy.isTransientError.
-->
