---
"@cosmicdrift/kumiko-framework": minor
---

extraRoutes/hostDispatch move to structured route and wire definitions

<!-- kumiko-changes
feature: framework
type: breaking
title: extraRoutes/hostDispatch move to structured route and wire definitions
migration: |
  extraRoutes on runProdApp/createKumikoServer/runDevApp/setupTestStack changes from (app, deps) => void to readonly ExtraRouteDefinition[]. Each entry is { method, path, entry: "anonymous" | "user" | "signature", handler }, built via the helpers in @cosmicdrift/kumiko-framework/api; a signature route also needs verify(request, deps) via signatureRoute<T>(). An anonymous GET route that used to call app.get(path, handler) on the raw app now receives { app, registry, systemQuery } - replace direct db/redis reads with systemQuery. A route reading user data via a raw db handle now declares entry: "user" (path must live under /api/, unauthenticated requests get 401 automatically) and receives { app, registry, user, query, write } instead of db/redis. A route verifying an external signature (webhooks) declares entry: "signature" and receives { app, registry, secrets?, systemQuery, dispatchSystemWrite, dispatchSystemQuery }; reject invalid signatures with ExtraRouteRejection(status, body) from verify. Non-route setup that used to run inside the old extraRoutes(app, deps) callback (late-binding, background seeds, starting a runner) moves to the new wire?: (deps: SystemWireDeps) => void | Promise<void> option on runProdApp/createKumikoServer, which gets { db, redis, registry, dispatchSystemWrite } but no app. hostDispatch (dev) and HostDispatchFn (runProdApp) gain a second argument { systemQuery }; an app.use middleware that read db directly for host dispatch now uses systemQuery instead.
-->
