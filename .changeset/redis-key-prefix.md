---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

Apps sharing one Redis can be confined to a per-app ACL user: `KUMIKO_REDIS_PREFIX` puts every key, the BullMQ queues and every Pub/Sub channel under `<prefix>:`, and `KUMIKO_SHUTDOWN_DRAIN_TIMEOUT_MS` lets a SIGTERM wait for running jobs.

<!-- kumiko-changes
feature: framework
type: improvement
title: KUMIKO_REDIS_PREFIX namespaces all Redis keys and channels
detail: redisNamespaceFromEnv resolves keyPrefix, bullmqPrefix, channelPrefix and the subscribe pattern. Unset keeps today's layout (bull:*, unprefixed locks, rate limit, idempotency and cache keys). Set, the main ioredis client gets keyPrefix <P>:, the job runner passes prefix <P>:bull to every Queue and Worker (new JobRunnerOptions.redisNamespace, also on the entrypoint jobs block) and gives its lock client the keyPrefix, and the SSE broker, cache-sync bus and toggle signal use <P>: channels. Redis matches PSUBSCRIBE patterns literally against ACL channel rules, so with a prefix they subscribe to <P>:* and filter by channel. A value with ":" or glob characters, or a KUMIKO_REDIS_CHANNEL_PREFIX that differs from it, aborts the boot. The cache-sync bus of runProdApp, runWorkerApp and createDefaultCacheSyncBus now also honours KUMIKO_REDIS_CHANNEL_PREFIX alone (before, only SSE and toggle channels did). JobRunner gains an optional stopConsuming(), which createJobRunner implements. The ACL rule set and the key layout for a wake-up service are in docs/reference/infra-requirements.md.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: runProdApp and runWorkerApp use the Redis prefix and drain running jobs on SIGTERM
detail: Both boots pass the namespace to the Redis client, the cache-sync bus and the job runner, so enqueuer and consumer share one key space. KUMIKO_SHUTDOWN_DRAIN_TIMEOUT_MS (positive integer, invalid aborts the boot) sets the drain budget; signals.drainTimeoutMs wins, the default stays 25 s. Entrypoint stop() now stops every job lane fetching first, then waits for active jobs up to that budget before the database and Redis close; before, the lifecycle's fixed 40 s cut the wait short.
-->

<!-- kumiko-changes
feature: feature-toggles
type: improvement
title: Feature-toggle Redis signal follows KUMIKO_REDIS_PREFIX
detail: createRedisToggleSyncSignal takes an optional channelSubscribePattern (default from KUMIKO_REDIS_PREFIX) and ignores messages from other channels, which a prefix-wide subscription delivers.
-->
