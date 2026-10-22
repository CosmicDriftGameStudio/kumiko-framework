---
"@cosmicdrift/kumiko-framework": patch
---

`buildServer()` is now a short composer that calls one installer per middleware and one mounter per route group in a fixed, documented order.

<!-- kumiko-changes
feature: framework
type: improvement
title: buildServer split into middleware installers and route mounters
detail: buildServer() keeps its signature and behavior. Boot checks, pre-app wiring, the event dispatcher, middleware installers and route mounters now live in server-*.ts files next to server.ts. withFileProviderResolver and makeDispatchSystemWrite/makeDispatchWriteAs/makeDispatchSystemQuery are still exported from the api barrel under the same names.
-->
