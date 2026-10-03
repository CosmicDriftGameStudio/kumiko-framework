---
"@cosmicdrift/kumiko-framework": minor
---

Tenant timezone cache is invalidated across processes

A config write to tenant:config:timezone now invalidates the cached value on every API and worker pod after commit, instead of letting it live until the 5 minute TTL. The signal travels over the new CacheSyncBus (Redis when REDIS_URL is set, process-local otherwise); DispatcherOptions.cacheSync overrides it and null opts out. setupTestStack gains cacheSync, implied by sharedRedisWith, to test two instances on one Redis. This replaces the earlier tenantTimezoneSync option.

<!-- kumiko-changes
feature: framework
type: improvement
title: Tenant timezone cache is invalidated across processes
-->
