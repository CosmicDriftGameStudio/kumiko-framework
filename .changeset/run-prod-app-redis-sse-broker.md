---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

Fix `runProdApp` silently bypassing the Redis-backed cross-replica `SseBroker` default that fw#2630 introduced. `runProdApp` built its own in-memory broker unconditionally and passed it in as `ServerOptions.sseBroker`, which always wins over `buildServer`'s own `REDIS_URL`-gated default — so under `replicas > 1` in production, SSE broadcast and access-invalidation events never reached any pod other than the one that happened to own the shared event-store cursor.

Both `buildServer` and `runProdApp` now funnel through a new shared decision point, `createDefaultSseBroker` (new export from `@cosmicdrift/kumiko-framework/api`, alongside the `isRedisSseBroker` type guard): `REDIS_URL` present → Redis-backed broker, absent → the in-memory one. `runProdApp` also now closes the Redis-backed broker on graceful shutdown, matching the lifecycle `buildServer` already had.
