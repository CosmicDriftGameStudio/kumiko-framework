---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

Add `createRedisLoginRateLimiter` (`@cosmicdrift/kumiko-framework/api`) and default `runProdApp`'s `/auth/login` + `/auth/mfa/verify` rate limiting to it instead of `createInMemoryLoginRateLimiter`. The in-memory limiter counts per process — a multi-replica prod deployment silently gave each replica its own bucket, so an attacker spread across replicas evaded the limit without any warning or error (#1262, #1274). Redis is already required infra for `runProdApp` (`REDIS_URL`), so this closes the gap with no new config.
