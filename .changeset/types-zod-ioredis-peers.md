---
"@cosmicdrift/kumiko-types": patch
---

kumiko-types declares zod and ioredis as peer dependencies

The published `.d.ts` files import `zod` and `ioredis`, so consumers need both for type resolution. `ioredis` is an optional peer.

<!-- kumiko-changes
feature: types
type: improvement
title: kumiko-types declares zod and ioredis as peer dependencies
-->
