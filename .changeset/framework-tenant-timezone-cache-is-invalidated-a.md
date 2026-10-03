---
"@cosmicdrift/kumiko-framework": minor
---

Tenant timezone cache is invalidated across processes

A config write to tenant:config:timezone now publishes a Redis Pub/Sub invalidation after commit, so other API and worker pods drop their cached value instead of serving it until the 5 minute TTL. Active when REDIS_URL is set; DispatcherOptions.tenantTimezoneSync overrides it (null opts out). setupTestStack gains sharedRedisWith and tenantTimezoneSync to test two instances on one Redis.

<!-- kumiko-changes
feature: framework
type: improvement
title: Tenant timezone cache is invalidated across processes
-->
