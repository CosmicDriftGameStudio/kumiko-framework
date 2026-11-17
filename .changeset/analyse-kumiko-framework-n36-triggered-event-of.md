---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

`triggeredEventOf` turns an event-triggered job's payload into a typed event union.

<!-- kumiko-changes
feature: jobs
type: improvement
title: Typed payload for event-triggered jobs
detail: `triggeredEventOf(events, payload, ctx)` from `@cosmicdrift/kumiko-framework/engine` takes the `r.defineEvent` results a job triggers on. It finds the one named by `ctx.triggerName`, parses the payload with its schema and returns `{ type, payload }` as a discriminated union of those events. A trigger outside the list, a payload that does not match, or an event with personal fields (they reach the job encrypted) throws, so the run fails instead of reading undefined fields. Jobs no longer need typeof chains on `Record<string, unknown>`.
-->
