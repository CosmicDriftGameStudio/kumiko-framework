---
"@cosmicdrift/kumiko-server-runtime": patch
---

`runProdApp`'s personal-access-token rate limiter now defaults to `createRedisLoginRateLimiter` instead of `createInMemoryLoginRateLimiter` — same bug as #1274, just for PATs: an in-process counter gives each replica its own bucket in a multi-instance prod deployment, so the limit is trivially evaded by spreading requests across replicas (#1287).
