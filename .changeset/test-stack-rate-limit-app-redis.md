---
"@cosmicdrift/kumiko-framework": patch
---

setupTestStack rate-limit resolver uses the app-supplied redis

<!-- kumiko-changes
feature: framework
type: fix
title: Test-stack rate limiting follows appContext.redis when rateLimitNowMs is set
detail: With rateLimitNowMs the test stack builds its own rate-limit resolver; it now uses the redis instance passed via the app context instead of always the internal test redis, so buckets prefilled or cleared through the app redis take effect.
-->
