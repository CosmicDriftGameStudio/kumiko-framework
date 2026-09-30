---
"@cosmicdrift/kumiko-framework": patch
---

bun-db logs a diagnostic warning when a closed-connection error surfaces

When a closed-connection error leaves bun-db (retries exhausted, a transaction/reserved handle, or a write path), a `[bun-db] closed connection surfaced` warning records driver, pooled vs. transaction handle, attempts, pool size, timeouts and the error code. It never includes SQL text or parameters. Behaviour, retries and timeouts are unchanged.

<!-- kumiko-changes
feature: framework
type: improvement
title: bun-db logs a diagnostic warning when a closed-connection error surfaces
-->
