---
"@cosmicdrift/kumiko-framework": patch
---

Boot warns on tenant or user rate limits without a RateLimitResolver.

<!-- kumiko-changes
feature: framework
type: fix
title: Boot warns on tenant or user rate limits without a RateLimitResolver
detail: A handler `rateLimit` with a `tenant` or `user` bucket needs a `RateLimitResolver`. Without one the server still boots but logs a warning naming the handlers, which answer every call with a 500. Wire a Redis client on `context.redis` or pass `context.rateLimit`.
-->
