---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

`triggeredEventOf` turns an event-triggered job's payload into a typed event union.

<!-- kumiko-changes
feature: jobs
type: improvement
title: Typed payload for event-triggered jobs
detail: `await triggeredEventOf(events, payload, ctx)` from `@cosmicdrift/kumiko-framework/engine` takes the `r.defineEvent` results a job triggers on. It finds the one named by `ctx.triggerName`, decrypts the event's catalogued personal fields with the subject KMS, parses the payload with its schema and returns `{ type, payload }` as a discriminated union of those events. Personal fields stay ciphertext in the job queue and are only decrypted inside the run; a field of an erased subject comes back as the erased sentinel. A trigger outside the list, a payload that does not match, or a ciphertext field without a configured subject KMS throws, so the run fails instead of reading undefined fields. Jobs no longer need typeof chains on `Record<string, unknown>`.
-->
