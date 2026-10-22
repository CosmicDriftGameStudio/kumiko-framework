---
"@cosmicdrift/kumiko-framework": patch
---

The access-invalidation consumer no longer ends up dead-lettered during a longer Redis outage. It keeps retrying with an exponential backoff (250 ms up to 10 s) until the publish goes through, so later revocations still reach open SSE streams once Redis is back.

<!-- kumiko-changes
feature: framework
type: fix
title: Access invalidation survives a Redis outage
detail: The consumer that pushes session, token and membership revocations to open streams has no attempt limit anymore and backs off between publish attempts, instead of dying after 10 failed deliveries and silently dropping later revocations.
-->
