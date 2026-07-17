---
"@cosmicdrift/kumiko-framework": patch
---

setupTestStack: stop a partially-started JobRunner (and its live BullMQ Redis
connections) if any later setup step throws, instead of leaking it until the
test process hangs on exit. Also pass through the real REDIS_URL for the
JobRunner's connection instead of reconstructing one from parsed
`redis.options` (which dropped password/username/tls/path) — `TestRedis` now
exposes `redisUrl` for this.
