---
"@cosmicdrift/kumiko-testing": minor
---

createE2eSeedRoutes() returns ExtraRouteDefinition[] instead of an extraRoutes callback

<!-- kumiko-changes
feature: testing
type: breaking
title: createE2eSeedRoutes() returns ExtraRouteDefinition[] instead of an extraRoutes callback
migration: |
  createE2eSeedRoutes() now returns readonly ExtraRouteDefinition[] instead of an (app, deps) => void callback. The call site extraRoutes: createE2eSeedRoutes() in setupTestStack is unchanged, but any code that imported createE2eSeedRoutes() to invoke it directly against app (rather than passing it through extraRoutes) must instead treat the result as a route list, e.g. register each entry through the framework's ExtraRouteDefinition handling.
-->
