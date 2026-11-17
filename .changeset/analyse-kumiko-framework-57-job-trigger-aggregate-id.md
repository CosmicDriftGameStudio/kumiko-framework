---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": patch
---

A job triggered by a write handler now gets the stored event of the handler's save or delete result as `ctx.triggerEvent`, and `JobTriggerEvent` carries the event's `aggregateId`.

<!-- kumiko-changes
feature: jobs
type: breaking
title: Write-handler job triggers carry the written row id
detail: `r.job` with `trigger: { on: "<feature>:write:<handler>" }` received only the handler's input payload, so a follow-up job could not tell which row was created and had to sweep the tenant. When the handler returns a save or delete lifecycle result (every `r.crud` verb and executor write), the job now gets `ctx.triggerEvent = { id, aggregateId, headers }` of that event; `aggregateId` is the written row's id. Handlers that return plain data still run the job without `triggerEvent`. `JobTriggerEvent` gained the required field `aggregateId`, also on the job-trigger and catch-up consumer paths.
migration: Code that builds a `JobTriggerEvent` itself, for example a test calling `jobRunner.handleCatchUpEvent(...)`, adds `aggregateId` (the stored event's `aggregateId`). Jobs that swept the tenant because the id was missing can read `ctx.triggerEvent?.aggregateId` instead.
affects: JobTriggerEvent, handleCatchUpEvent, triggerEvent
-->
