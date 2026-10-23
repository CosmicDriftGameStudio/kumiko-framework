---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Jobs see whether they can still defer with `ctx.canDefer`.

<!-- kumiko-changes
feature: framework
type: breaking
title: Jobs see whether they can still defer (ctx.canDefer)
detail: ctx.canDefer is false when the run is inline or the maxDefers budget is used up, so a handler can write its terminal state instead of deferring into an UnrecoverableError. Behaviour of ctx.defer and the maxDefers failure is unchanged.
migration: |
  JobContext has a new required field canDefer. Code that builds a JobContext object by hand (boot seeds, test fixtures) adds `canDefer: false` unless the context really supports ctx.defer. Contexts built by the job runner or cast with `as unknown as JobContext` need no change.
-->
