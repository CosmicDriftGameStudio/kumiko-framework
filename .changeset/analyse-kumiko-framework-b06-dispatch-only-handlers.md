---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-feature-ast": patch
---

Write handlers can declare `dispatchOnly: true` so only server code reaches them.

<!-- kumiko-changes
feature: framework
type: feature
title: Dispatch-only write handlers
detail: A write handler with `dispatchOnly: true` runs only through ctx.dispatch, jobs and server routes, with the calling user kept. POST /api/write, /api/batch and /api/command answer it with the 404 of an unknown handler, and the agent manifest leaves it out. Boot rejects it together with `agent.expose: true` or `tenantlessAnonymous`. Use it for the sub-steps of a perCommand handler.
-->
