---
"@cosmicdrift/kumiko-dev-server": minor
---

createKumikoServer/runDevApp take ExtraRouteDefinition[]; dev hostDispatch gets systemQuery

<!-- kumiko-changes
feature: dev-server
type: breaking
title: createKumikoServer/runDevApp take ExtraRouteDefinition[]; dev hostDispatch gets systemQuery
migration: |
  extraRoutes on createKumikoServer/runDevApp changes from (app, deps) => void to readonly ExtraRouteDefinition[] - see the framework core changelog entry for the route-kind/dep breakdown. wire?: (deps: SystemWireDeps) => void | Promise<void> replaces non-route setup previously done inside the old extraRoutes callback. The dev hostDispatch callback now receives a second argument { systemQuery }; a dispatch implementation reading the dev db directly switches to systemQuery.
-->
