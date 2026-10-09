---
"@cosmicdrift/kumiko-framework": patch
---

ctx.queryAsMember read-only context now allowlists searchAdapter (search), redis (read commands) and entityCache (get, mget); other methods are denied

<!-- kumiko-changes
feature: framework
type: fix
title: ctx.queryAsMember read-only context now allowlists searchAdapter (search), redis (read commands) and entityCache (get, mget); other methods are denied
-->
