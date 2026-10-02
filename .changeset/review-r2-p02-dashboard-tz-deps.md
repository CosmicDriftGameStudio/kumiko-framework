---
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Dashboard time-range queries now send the user's time zone, so metric day buckets line up with the axis labels instead of being cut in UTC. `kumiko-bundled-features` declares `ioredis` and `hono`, which its emitted type declarations import.

<!-- kumiko-changes
feature: renderer-web
type: fix
title: Dashboard time-range queries carry the user's time zone so day buckets match the axis labels
-->
