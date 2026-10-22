---
"@cosmicdrift/kumiko-framework": patch
---

`GET /files/meta?ids=` is charged by the number of ids when a rate-limit resolver is wired. Each id costs a KMS-decrypting read, so one request for 100 ids now takes 100 from a per-user budget of 1000 ids per minute instead of counting as a single request.

<!-- kumiko-changes
feature: framework
type: fix
title: files meta batch route is rate limited by id count
detail: createFileRoutes takes an optional metaBatchRateLimitResolver, wired by the server from the rate-limit resolver or Redis. A user over 1000 requested ids per minute gets 429 rate_limited; a failing limiter fails open and is reported like the other limiters.
-->
