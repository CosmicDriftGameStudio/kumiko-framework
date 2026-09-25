---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Event-triggered jobs get the triggering event's id and headers via ctx.triggerEvent

<!-- kumiko-changes
feature: framework
type: improvement
title: Event-triggered jobs get the triggering event's id and headers via ctx.triggerEvent
detail: |
  r.job's `trigger.on` reached via an r.defineEvent QN (async, at-least-once
  delivery through the job-trigger event consumer) had no way to key an
  idempotency check on the stored event that fired it. JobContext now
  carries `triggerEvent?: { id, headers }` — the stored event's id and
  metadata.headers — when the job was reached this way. Undefined for
  cron/manual jobs and for jobs triggered synchronously off a write/query
  handler (no stored event to hand over). No migration needed.
-->
