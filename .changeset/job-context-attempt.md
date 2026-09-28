---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

JobContext exposes ctx.attempt and ctx.finalAttempt

<!-- kumiko-changes
feature: framework
type: improvement
title: JobContext exposes ctx.attempt and ctx.finalAttempt
detail: |
  Job handlers can read the 1-based run number and whether the current run is
  the last one BullMQ will attempt, so a handler can defer writing a
  business-facing failure state until the final attempt instead of writing
  it on every retry.

  Migration note: hand-built `JobContext` objects (test doubles, boot
  seeders) must add `attempt` and `finalAttempt` (e.g. `attempt: 1,
  finalAttempt: true`).
-->
