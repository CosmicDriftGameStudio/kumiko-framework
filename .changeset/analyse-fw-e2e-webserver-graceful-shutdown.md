---
"@cosmicdrift/kumiko-testing": patch
---

`defineAppE2eConfig` stops the e2e server with SIGTERM, so the dev server removes its job queues from Redis.

<!-- kumiko-changes
feature: testing
type: fix
title: E2E server shuts down cleanly and leaves no job queues in Redis
detail: Playwright ended the webServer with SIGKILL, so the dev server never ran its shutdown and every e2e run left its per-boot `bull:kumiko-dev-*` keys in the shared Redis. The webServer now gets SIGTERM with a 10 second grace period before Playwright kills it.
-->
