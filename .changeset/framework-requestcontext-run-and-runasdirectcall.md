---
"@cosmicdrift/kumiko-framework": minor
---

requestContext.run and runAsDirectCallEntry removed from the public /api barrel; requestContext there is read-only

<!-- kumiko-changes
feature: framework
type: breaking
title: requestContext.run and runAsDirectCallEntry removed from the public /api barrel; requestContext there is read-only
migration: |
  Import run and runAsDirectCallEntry from @cosmicdrift/kumiko-framework/internal/request-context; reserved for agent-tools and server runtime wiring, do not use to lift a handler past the risk floor. requestContext.get() from /api is unchanged.
-->
