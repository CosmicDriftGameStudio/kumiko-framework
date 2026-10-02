---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`isRedisSseBroker` now narrows on a `kind: "redis"` discriminant that `createRedisSseBroker` sets, so an app-owned broker that happens to expose `close()` is no longer mistaken for the Redis one. The tenant-lifecycle gate cache is capped at 5000 entries, so anonymous requests with random `X-Tenant` ids can no longer grow it without bound.

<!-- kumiko-changes
feature: framework
type: fix
title: isRedisSseBroker narrows on a kind discriminant, tenant-lifecycle gate cache is bounded
-->
