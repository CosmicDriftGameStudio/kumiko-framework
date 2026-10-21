---
"@cosmicdrift/kumiko-testing": patch
---

`createTestRedis` resolves only once its connection is ready.

<!-- kumiko-changes
feature: testing
type: fix
title: createTestRedis waits for a ready connection
detail: The test Redis client connected in the background, so the first rate-limit check in a test file could see status "connect" and fail with "rate-limit redis connection not ready". createTestRedis now connects explicitly and returns after the connection is ready.
-->
