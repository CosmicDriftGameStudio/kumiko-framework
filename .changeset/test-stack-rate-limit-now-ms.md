---
"@cosmicdrift/kumiko-framework": patch
---

setupTestStack accepts `rateLimitNowMs`, the time source of the stack's rate-limit resolver, so tests can freeze the token-bucket clock instead of racing the refill window

<!-- kumiko-changes
feature: framework
type: improvement
title: setupTestStack accepts rateLimitNowMs to freeze the rate-limit clock in tests
-->
