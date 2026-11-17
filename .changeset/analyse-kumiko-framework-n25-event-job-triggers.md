---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Jobs trigger on events only; a handler name as job trigger fails the boot.

<!-- kumiko-changes
feature: jobs
type: breaking
title: Job triggers on events only
detail: `r.job({ trigger: { on } })` accepts an `r.defineEvent` event (qualified or the own feature's short name) or an entity lifecycle event such as `order.created`. A write or query handler name now fails the boot with a message that names the alternatives. The job-trigger event consumer enqueues every event-triggered job after the commit, with a deterministic job id per job and event. A crash between commit and enqueue no longer loses the job, and a redelivered event does not enqueue it twice. The write response no longer waits for the job enqueue. The bundled `run-requested-export` job triggers on `export-job.created`, and readiness `run-probes` triggers on `probe-run.created`. `delivery:write:unsubscribeAddress` appends `delivery:event:address-unsubscribed` (`DELIVERY_ADDRESS_UNSUBSCRIBED_EVENT`, payload `unsubscribeAddressPayloadSchema`).
migration: Replace every job trigger on a handler name. When the handler writes an entity through crud or an executor, trigger on `<entity>.created`, `.updated` or `.deleted`; the job payload is the event payload, and `ctx.triggerEvent.aggregateId` is the row id. Otherwise define an event with `r.defineEvent`, append it in the handler with `ctx.events.append`, and trigger on it. A job on `DeliveryHandlers.unsubscribeAddress` triggers on `DELIVERY_ADDRESS_UNSUBSCRIBED_EVENT`. Tests that ran a job right after a write call `stack.drainJobs()`, which also waits for the event consumer.
-->
