---
"@cosmicdrift/kumiko-framework": patch
---

Handlers with additionalRateLimits fail at boot when no RateLimitResolver exists

<!-- kumiko-changes
feature: framework
type: fix
title: buildServer throws at boot when a handler declares additionalRateLimits but no RateLimitResolver can be built
detail: Without a Redis client or context.rateLimit every call to such a handler (auth-email-password signup and token requests, waitlist submit) answered 500 at request time. buildServer now throws at boot and names the handlers.
migration: Wire a Redis client on context.redis (or pass context.rateLimit). For the waitlist without Redis, pass emailRateLimits: [].
-->
