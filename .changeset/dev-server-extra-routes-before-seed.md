---
"@cosmicdrift/kumiko-dev-server": patch
---

`extraRoutes` is now registered before `onAfterSetup` (seeds) instead of after. A seed that dispatches through `stack.http` builds Hono's matcher, and every route added afterwards threw `Can not add a route since the matcher is already built` — so an app could have seeds or its own routes, but not both.
