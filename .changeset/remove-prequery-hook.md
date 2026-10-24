---
"@cosmicdrift/kumiko-framework": minor
---

preQuery hooks were never invoked by the query pipeline; the hook type, its registry storage and `getPreQueryHooks` are removed.

<!-- kumiko-changes
feature: framework
type: breaking
title: preQuery hooks removed
detail: |
  `r.hook({ type: "preQuery", … })` registered a hook that the query pipeline never called. The `preQuery` hook type, `PreQueryHookFn`, the `preQuery` slot of the hook maps and registrar extension hooks, and `registry.getPreQueryHooks` are removed. A `type: "preQuery"` registration is now a type error and throws at feature registration instead of being silently ignored.
migration: |
  No known users. Remove `r.hook({ type: "preQuery", … })` registrations; they never ran. To change a query payload, validate or transform it inside the query handler.
-->
