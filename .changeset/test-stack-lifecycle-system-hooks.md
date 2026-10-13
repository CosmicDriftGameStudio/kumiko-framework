---
"@cosmicdrift/kumiko-framework": minor
---

`setupTestStack` accepts `lifecycleSystemHooks`, a `SystemHooks` object that is handed to the server as its system hooks, so integration tests can run lifecycle hooks such as the cascade-delete hook that the stack does not wire by itself.

<!-- kumiko-changes
feature: framework
type: improvement
title: setupTestStack option lifecycleSystemHooks
detail: Passes the given SystemHooks to buildServer, so tests can exercise pipeline lifecycle hooks like createCascadeDeleteHook through the real HTTP stack.
-->
