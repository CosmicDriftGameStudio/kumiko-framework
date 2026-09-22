---
"@cosmicdrift/kumiko-bundled-features": minor
---

createInboundMailConnectRoutes() returns ExtraRouteDefinition[] with static options only

<!-- kumiko-changes
feature: inbound-mail-foundation
type: breaking
title: createInboundMailConnectRoutes() returns ExtraRouteDefinition[] with static options only
migration: |
  createInboundMailConnectRoutes(options) now returns readonly ExtraRouteDefinition[] (connect route as entry: "user", callback route as entry: "signature") instead of mounting itself on app. options is now static config only - any db/registry/dispatch values previously passed through options are supplied by the framework via the route's deps instead. Replace extraRoutes: (app, deps) => createInboundMailConnectRoutes(options)(app, deps) with extraRoutes: createInboundMailConnectRoutes(options) (spread into the app's route array alongside other route definitions).
-->
